const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('attendance migrations, time pay, snapshots, payroll locks and employee isolation', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    create type public.app_role as enum ('admin','front_desk','artist','printing','heat_press','cutting_sewing','qc');
    create table public.profiles(id uuid primary key,role public.app_role,active boolean default true,full_name text);
    create table public.orders(id uuid primary key);
    create table public.production_tasks(id uuid primary key);
    create function public.current_app_role() returns public.app_role language sql stable security definer set search_path=public
      as $$ select role from profiles where id=auth.uid() and active $$;
    create function public.has_any_role(roles public.app_role[]) returns boolean language sql stable security definer set search_path=public
      as $$ select coalesce(public.current_app_role()=any(roles),false) $$;
    alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
  `);
  for (const file of [
    '202610200007_employee_work_payroll.sql',
    '20261026043803_payroll_cash_advance.sql',
    '20261026060520_sewing_only_work_tracking.sql',
    '20261027023029_attendance_based_payroll.sql',
    '20261027023537_qr_time_attendance.sql',
    '20261027031811_public_qr_attendance.sql',
    '20261027124647_employee_cash_advance_ledger.sql',
    '20261027131046_payroll_overtime.sql',
    '20261028023512_qr_attendance_approval.sql',
    '20261028063252_payroll_sss_deductions.sql',
    '20261028080216_employee_payslips.sql',
    '20261028085057_employee_salary_info.sql',
  ]) await db.exec(fs.readFileSync(`supabase/migrations/${file}`, 'utf8'));
  const admin = '00000000-0000-0000-0000-000000000001';
  const artist = '00000000-0000-0000-0000-000000000002';
  const printer = '00000000-0000-0000-0000-000000000003';
  const sewer = '00000000-0000-0000-0000-000000000004';
  await db.query(`insert into profiles(id,role,full_name) values ($1,'admin','Owner'),($2,'artist','Artist'),($3,'printing','Printer'),($4,'cutting_sewing','Sewer')`, [admin, artist, printer, sewer]);
  const actAs = async id => { await db.exec('reset role'); await db.query(`select set_config('test.uid',$1,false)`, [id ?? '']); await db.exec('set role authenticated'); };
  const row = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const save = (employee, day, a, b, c, d) => db.query('select save_attendance_log($1,$2,$3,$4,$5,$6)', [employee, day, a, b, c, d]);
  await t.test('payslips validate amounts, retain snapshots, prevent duplicates, and restrict access', async () => {
    const amounts = {basic_pay:8000,overtime_pay:500,bonus:200,backpay:100,sss:300,philhealth:100,pagibig:100,other_deductions:200};
    const issue = (values = amounts, end = '2026-01-15') => db.query("select issue_employee_payslip($1,'2026-01-15','2026-01-01',$2,$3) as slip", [artist,end,JSON.stringify(values)]);
    await actAs(admin);
    const slip = (await issue()).rows[0].slip;
    assert.equal(Number(slip.net_pay), 8100);
    assert.equal(slip.employee_name, 'Artist');
    assert.equal(slip.issued_by, admin);
    await assert.rejects(issue(), /already exists/);
    await assert.rejects(issue({...amounts,sss:-1}), /non-negative/);
    await assert.rejects(issue({...amounts,sss:0.001}), /decimal places/);
    await assert.rejects(issue({...amounts,sss:null}), /number for/);
    await assert.rejects(issue({...amounts,sss:99999}), /check constraint/);
    await assert.rejects(issue(amounts,'2025-12-01'), /valid issue/);
    await db.exec('reset role');
    await db.query("update profiles set full_name='Changed name' where id=$1", [artist]);
    await actAs(admin);
    assert.equal((await row('select employee_name from employee_payslips where id=$1', [slip.id])).employee_name, 'Artist');
    await assert.rejects(db.query('update employee_payslips set basic_pay=1 where id=$1', [slip.id]), /permission denied/);
    await actAs(artist);
    assert.equal((await db.query('select * from employee_payslips')).rows.length, 1);
    await actAs(printer);
    assert.equal((await db.query('select * from employee_payslips')).rows.length, 0);
    await actAs(artist);
    await assert.rejects(issue(), /Only an active admin/);
    await db.exec('reset role; set role anon');
    await assert.rejects(issue(), /permission denied/);
    await assert.rejects(db.query('select * from employee_payslips'), /permission denied/);
    await actAs(admin);
  });
  await actAs(admin);
  const qr = (await row('select save_attendance_qr($1,800) as token', [artist])).token;
  const printerQr = (await row('select save_attendance_qr($1,600) as token', [printer])).token;
  await assert.rejects(db.query('select save_attendance_qr($1,800)', [sewer]), /non-sewing/);
  await assert.rejects(db.query('select save_attendance_qr($1,$2)', [artist, 'NaN']), /valid daily salary/);

  await t.test('full day, lunch excluded, late and undertime deductions', async () => {
    await save(artist, '2026-01-01', '07:30', '12:30', '13:00', '18:00');
    let log = await row("select * from employee_attendance where work_date='2026-01-01'");
    assert.equal(Number(log.hours), 8); assert.equal(Number(log.net_pay), 800); assert.equal(Number(log.deductions), 0);
    await save(artist, '2026-01-02', '08:30', '12:00', '13:00', '16:30');
    log = await row("select * from employee_attendance where work_date='2026-01-02'");
    assert.equal(Number(log.hours), 7); assert.equal(Number(log.net_pay), 700); assert.equal(Number(log.deductions), 100);
    await save(artist, '2026-01-03', '08:01', '12:00', '13:00', '17:00');
    assert.equal(Number((await row("select net_pay from employee_attendance where work_date='2026-01-03'")).net_pay), 798.33);
  });
  await t.test('half days, absences, invalid sequences and future dates', async () => {
    await save(artist, '2026-01-04', null, null, '13:00', '17:00');
    assert.equal(Number((await row("select net_pay from employee_attendance where work_date='2026-01-04'")).net_pay), 400);
    await save(artist, '2026-01-05', null, null, null, null);
    assert.equal(Number((await row("select net_pay from employee_attendance where work_date='2026-01-05'")).net_pay), 0);
    await assert.rejects(save(artist, '2026-01-06', null, '12:00', null, null), /attendance_am_order/);
    await assert.rejects(save(artist, '2026-01-06', '12:00', '08:00', null, null), /attendance_am_order/);
    await assert.rejects(save(artist, '2099-01-01', null, null, null, null), /earlier work date/);
  });
  await t.test('custom grace and deduction switches apply only to new attendance days', async () => {
    await db.exec('update attendance_schedule set grace_minutes=10');
    await save(artist, '2025-12-01', '08:05', '12:00', '13:00', '17:00');
    assert.equal(Number((await row("select net_pay from employee_attendance where work_date='2025-12-01'")).net_pay), 800);
    await save(artist, '2025-12-02', '08:11', '12:00', '13:00', '17:00');
    assert.equal(Number((await row("select net_pay from employee_attendance where work_date='2025-12-02'")).net_pay), 781.67);
    await db.exec('update attendance_schedule set deduct_late=false,deduct_undertime=false');
    await save(artist, '2025-12-03', '09:00', '11:00', '14:00', '16:00');
    assert.equal(Number((await row("select net_pay from employee_attendance where work_date='2025-12-03'")).net_pay), 800);
    await save(artist, '2025-12-02', '08:11', '12:00', '13:00', '17:00');
    assert.equal(Number((await row("select net_pay from employee_attendance where work_date='2025-12-02'")).net_pay), 781.67);
    await db.exec('update attendance_schedule set grace_minutes=0,deduct_late=true,deduct_undertime=true');
  });
  await t.test('custom schedule and salary changes preserve previous snapshots', async () => {
    await db.query('select save_attendance_qr($1,1000)', [artist]);
    await db.exec("update attendance_schedule set am_start='09:00',am_end='12:00',pm_start='14:00',pm_end='17:00'");
    await save(artist, '2026-01-01', '08:00', '12:00', '13:00', '17:00');
    assert.equal(Number((await row("select net_pay from employee_attendance where work_date='2026-01-01'")).net_pay), 800);
    await save(artist, '2026-01-07', '09:00', '12:00', '14:00', '17:00');
    const log = await row("select * from employee_attendance where work_date='2026-01-07'");
    assert.equal(Number(log.hours), 6); assert.equal(Number(log.net_pay), 1000); assert.equal(Number(log.scheduled_minutes), 360);
  });
  await t.test('employees can only view and clock their own QR; cannot edit rates or logs', async () => {
    await actAs(artist);
    assert.equal((await db.query('select * from employee_attendance_qr')).rows.length, 1);
    assert.equal((await db.query('select * from employee_compensation')).rows.length, 1);
    await assert.rejects(db.query('select clock_attendance_qr($1,\'am_in\')', [printerQr]), /invalid, disabled/);
    await assert.rejects(db.query('select save_attendance_qr($1,999)', [artist]), /Only an active admin/);
    await assert.rejects(save(artist, '2026-01-08', '08:00', '12:00', null, null), /Only an active admin/);
    await assert.rejects(db.query("insert into employee_attendance(employee_id,work_date,hours) values($1,'2026-01-08',8)", [artist]), /row-level security/);
    assert.equal((await db.query('delete from employee_attendance_qr returning employee_id')).rows.length, 0);
    await db.exec("update attendance_schedule set am_start='05:00'");
    assert.equal((await row('select am_start from attendance_schedule')).am_start, '09:00:00');
    await actAs(admin);
  });
  await t.test('own QR uses server time and rejects duplicate actions', async () => {
    // Set a schedule permitting AM throughout most of the day for the live server-clock test.
    await db.exec("update attendance_schedule set am_start='00:00',am_end='23:58',pm_start='23:58',pm_end='23:59'");
    await actAs(artist);
    const time = (await row("select (clock_timestamp() at time zone 'Asia/Manila')::time as time")).time;
    const action = time < '23:58:00' ? 'am_in' : 'pm_in';
    await db.query('select clock_attendance_qr($1,$2)', [qr, action]);
    await assert.rejects(db.query('select clock_attendance_qr($1,$2)', [qr, action]), /already recorded/);
    const ownLogs = (await db.query('select * from employee_attendance')).rows;
    assert.ok(ownLogs.every(log => log.employee_id === artist));
    const log = ownLogs.find(log => log.approval_status === 'pending');
    assert.equal(log.approval_status, 'pending');
    await assert.rejects(db.query("select review_attendance_log($1,'approved')", [log.id]), /Only an active admin/);
    await actAs(admin);
    await assert.rejects(db.query('select create_payroll_run($1,$1)', [log.work_date]), /Review pending/);
    await db.query("select review_attendance_log($1,'approved')", [log.id]);
    let reviewed = await row('select * from employee_attendance where id=$1', [log.id]);
    assert.equal(reviewed.approval_status, 'approved');
    assert.equal(reviewed.reviewed_by, admin);
    assert.ok(reviewed.reviewed_at);
    await assert.rejects(db.query("select review_attendance_log($1,'rejected')", [log.id]), /no longer pending/);
    // Make time-in earlier so the second server-time punch works even within one second.
    await db.exec('reset role');
    await db.query(`update employee_attendance set ${action}='00:00' where id=$1`, [log.id]);
    await actAs(artist);
    await db.query('select clock_attendance_qr($1,$2)', [qr, action.replace('_in', '_out')]);
    reviewed = await row('select * from employee_attendance where id=$1', [log.id]);
    assert.equal(reviewed.approval_status, 'pending');
    assert.equal(reviewed.reviewed_by, null);
    assert.equal(reviewed.reviewed_at, null);
    await actAs(admin);
    await db.query("select review_attendance_log($1,'approved')", [log.id]);
    await db.exec('begin');
    const approvedRun = (await row('select create_payroll_run($1,$1) as id', [log.work_date])).id;
    const approvedLine = await row('select * from payroll_lines where payroll_run_id=$1 and employee_id=$2', [approvedRun, artist]);
    const approvedLog = await row('select * from employee_attendance where id=$1', [log.id]);
    assert.equal(Number(approvedLine.base_pay), Number(approvedLog.net_pay));
    assert.equal(Number(approvedLine.attendance_hours), Number(approvedLog.hours));
    await db.exec('rollback');
    // Reopen for review to exercise rejection independently of approval.
    await db.exec('reset role');
    await db.query("update employee_attendance set approval_status='pending' where id=$1", [log.id]);
    await actAs(admin);
    await db.query("select review_attendance_log($1,'rejected')", [log.id]);
    await db.exec('begin');
    const run = (await row('select create_payroll_run($1,$1) as id', [log.work_date])).id;
    const line = await row('select * from payroll_lines where payroll_run_id=$1 and employee_id=$2', [run, artist]);
    assert.equal(Number(line.attendance_hours), 0);
    assert.equal(Number(line.base_pay), 0);
    assert.equal((await row('select payroll_run_id from employee_attendance where id=$1', [log.id])).payroll_run_id, null);
    await db.exec('rollback');
  });
  await t.test('payroll blocks incomplete sessions and uses saved daily net pay, excluding layout', async () => {
    await save(artist, '2026-01-08', '09:00', null, null, null);
    await assert.rejects(db.query("select create_payroll_run('2026-01-01','2026-01-08')"), /Complete or correct/);
    await save(artist, '2026-01-08', null, null, null, null);
    await db.query("insert into employee_compensation(employee_id,salary_basis,pay_frequency,base_rate,piece_rate) values($1,'piece','daily',0,25)", [sewer]);
    await db.query("insert into employee_work_records(employee_id,role,activity,quantity,unit_rate,work_date,status) values ($1,'artist','Design / layout completed',20,100,'2026-01-01','approved'),($2,'cutting_sewing','Sewing completed',10,25,'2026-01-01','approved')", [artist, sewer]);
    const run = (await row("select create_payroll_run('2026-01-01','2026-01-08') as id")).id;
    const line = await row('select * from payroll_lines where payroll_run_id=$1 and employee_id=$2', [run, artist]);
    assert.equal(Number(line.base_pay), 3698.33); assert.equal(Number(line.production_pay), 0);
    assert.equal(Number((await row('select production_pay from payroll_lines where payroll_run_id=$1 and employee_id=$2', [run, sewer])).production_pay), 250);
    await assert.rejects(save(artist, '2026-01-01', null, null, null, null), /locked|cannot be changed/);
    await assert.rejects(save(printer, '2026-01-01', '09:00', '12:00', null, null), /locked/);
    const advance = (await row("select issue_employee_cash_advance($1,3000,'2026-01-01','CA-ATTENDANCE','Emergency') as id", [artist])).id;
    await db.query('select set_payroll_advance_recovery($1,$2,100)', [line.id, advance]);
    assert.equal(Number((await row('select total_pay from payroll_lines where id=$1', [line.id])).total_pay), 3598.33);
    await db.query("update payroll_lines set sss_deduction=250,sss_note='Employee share' where id=$1", [line.id]);
    assert.equal(Number((await row('select total_pay from payroll_lines where id=$1', [line.id])).total_pay), 3348.33);
    await db.query('update payroll_lines set overtime_hours=2,overtime_rate=100,adjustments=50 where id=$1', [line.id]);
    assert.equal(Number((await row('select total_pay from payroll_lines where id=$1', [line.id])).total_pay), 3598.33);
    await assert.rejects(db.query('update payroll_lines set sss_deduction=-1 where id=$1', [line.id]), /check constraint/);
    await assert.rejects(db.query("update payroll_lines set sss_deduction='NaN' where id=$1", [line.id]), /check constraint/);
    await actAs(artist);
    assert.equal((await db.query('update payroll_lines set sss_deduction=0 where id=$1 returning id', [line.id])).rows.length, 0);
    await actAs(admin);
    await db.query('select approve_payroll_run($1)', [run]);
    for (const employee of [artist, printer, sewer]) {
      await actAs(employee);
      const ownLines = (await db.query('select * from payroll_lines')).rows;
      assert.ok(ownLines.length > 0);
      assert.ok(ownLines.every(item => item.employee_id === employee));
      assert.equal((await row('select status from payroll_runs where id=$1', [run])).status, 'approved');
      assert.equal((await db.query('update payroll_lines set sss_deduction=0 where payroll_run_id=$1 returning id', [run])).rows.length, 0);
    }
    await db.exec('reset role');
    await db.query('update profiles set active=false where id=$1', [artist]);
    await actAs(artist);
    assert.equal((await db.query('select * from payroll_lines')).rows.length, 0);
    assert.equal((await db.query('select * from payroll_runs')).rows.length, 0);
    assert.equal((await db.query('select * from employee_payslips')).rows.length, 0);
    await db.exec('reset role');
    await db.query('update profiles set active=true where id=$1', [artist]);
    await actAs(admin);
    await assert.rejects(db.query('update payroll_lines set sss_deduction=0 where id=$1', [line.id]), /Only draft/);
    await assert.rejects(db.query('update payroll_lines set cash_advance=200 where id=$1', [line.id]), /Only draft/);
  });
  await t.test('public QR attendance works without login and grants no employee data access', async () => {
    await actAs(admin);
    const visitor = '00000000-0000-0000-0000-000000000005';
    await db.exec('reset role');
    await db.query("insert into profiles(id,role,full_name) values($1,'front_desk','Public QR test')", [visitor]);
    await actAs(admin);
    const token = (await row('select save_attendance_qr($1,500) as token', [visitor])).token;
    const time = (await row("select (clock_timestamp() at time zone 'Asia/Manila')::time as time")).time;
    const action = time < '23:58:00' ? 'am_in' : 'pm_in';
    await db.exec('reset role');
    await db.query("select set_config('test.uid','',false)");
    await db.exec('set role anon');
    const response = await row('select public_clock_attendance_qr($1,$2) as result', [token, action]);
    assert.equal(response.result, '');
    await assert.rejects(db.query('select public_clock_attendance_qr($1,$2)', [token, action]), /already recorded/);
    await assert.rejects(db.query('select public_clock_attendance_qr($1,$2)', ['00000000-0000-0000-0000-000000000000', action]), /invalid, disabled/);
    await assert.rejects(db.query('select * from employee_attendance'), /permission denied/);
    await assert.rejects(db.query('select * from employee_compensation'), /permission denied/);
    await assert.rejects(db.query('select * from employee_attendance_qr'), /permission denied/);
    await assert.rejects(db.query('select save_attendance_qr($1,100)', [visitor]), /permission denied/);
    await assert.rejects(db.query("select review_attendance_log(gen_random_uuid(),'approved')"), /permission denied/);
    await actAs(admin);
    const publicLog = await row('select * from employee_attendance where employee_id=$1', [visitor]);
    assert.equal(publicLog.approval_status, 'pending');
    await db.query("select review_attendance_log($1,'approved')", [publicLog.id]);
    assert.equal((await row('select approval_status from employee_attendance where id=$1', [publicLog.id])).approval_status, 'approved');
    await db.query('delete from employee_attendance_qr where employee_id=$1', [visitor]);
    await db.exec('reset role');
    await db.query("select set_config('test.uid','',false)");
    await db.exec('set role anon');
    await assert.rejects(db.query('select public_clock_attendance_qr($1,$2)', [token, action]), /invalid, disabled/);
    await actAs(admin);
  });
  await t.test('disabled QR and inactive employees cannot clock; anonymous access denied', async () => {
    await db.query('delete from employee_attendance_qr where employee_id=$1', [printer]);
    await actAs(printer);
    await assert.rejects(db.query('select clock_attendance_qr($1,\'am_in\')', [printerQr]), /invalid, disabled/);
    await db.exec('reset role'); await db.query('update profiles set active=false where id=$1', [artist]);
    await actAs(artist);
    await assert.rejects(db.query('select clock_attendance_qr($1,\'am_in\')', [qr]), /active attendance/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from employee_attendance_qr'), /permission denied/);
    await assert.rejects(db.query('select clock_attendance_qr($1,\'am_in\')', [qr]), /permission denied/);
  });
});
