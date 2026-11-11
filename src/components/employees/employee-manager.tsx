"use client";

import { SearchableList } from "@/components/ui/searchable-list";
import { PasswordField } from "@/components/ui/password-field";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, LoaderCircle, Pencil, Plus, ShieldCheck, UserRoundPlus, X } from "lucide-react";
import { deleteEmployee, changeEmployeePassword, createEmployee, listEmployees, updateEmployee, type EmployeeAccount } from "@/actions/employees";
import type { AppRole } from "@/lib/auth/permissions";

const roleOptions: { id: AppRole; label: string }[] = [
  { id: "admin", label: "Admin / Owner" }, { id: "front_desk", label: "Front Desk" },
  { id: "artist", label: "Artist / Layout Designer" }, { id: "printing", label: "Printing Staff" },
  { id: "heat_press", label: "Heat Press Staff" }, { id: "cutting_sewing", label: "Cutting / Sewing Staff" },
  { id: "qc", label: "Quality Control (QC)" },
];

export function EmployeeManager() {
  const [employees, setEmployees] = useState<EmployeeAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<EmployeeAccount | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("front_desk");
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listEmployees();
    if (result.error) setError(result.error);
    else { setEmployees(result.employees ?? []); setError(""); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const resetForm = () => { setName(""); setEmail(""); setPassword(""); setRole("front_desk"); setEditing(null); setShowForm(false); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError("");
    let result = editing
      ? await updateEmployee({ id: editing.id, name: name.trim(), role, active: editing.active })
      : await createEmployee({ name: name.trim(), email: email.trim(), password, role });
    if (editing && !("error" in result) && password) {
      result = await changeEmployeePassword({ id: editing.id, password });
      if ("error" in result) result = { error: `Employee details saved, but password was not changed: ${result.error}` };
    }
    setSaving(false);
    if ("error" in result) { setError(result.error); return; }
    setNotice(editing ? "Employee account updated." : "Employee account created. Share the login ID and password securely.");
    resetForm(); await load();
  };
  const edit = (employee: EmployeeAccount) => { setPassword(""); setEditing(employee); setName(employee.name); setEmail(employee.loginId); setRole(employee.role); setShowForm(true); };
  const remove = async (employee: EmployeeAccount) => {
    if (saving || !window.confirm(`Remove ${employee.name}'s account? Accounts with linked history will be deactivated to preserve their records. Otherwise the login will be permanently deleted.`)) return;
    setSaving(true); setError("");
    try {
      const result = await deleteEmployee(employee.id);
      if ("error" in result) setError(result.error);
      else { setNotice(result.deactivated ? "Employee access deactivated. Linked work and payroll history has been preserved." : "Employee account deleted."); if (editing?.id === employee.id) resetForm(); await load(); }
    } finally { setSaving(false); }
  };
  const changeActive = async (employee: EmployeeAccount) => {
    setError(""); const result = await updateEmployee({ id: employee.id, name: employee.name, role: employee.role, active: !employee.active });
    if ("error" in result) setError(result.error); else { setNotice(employee.active ? "Employee access deactivated." : "Employee access restored."); await load(); }
  };
  return <section className="employee-manager">
    <div className="employee-manager-heading"><div><div className="section-kicker">ADMIN WORKSPACE</div><h2>Employee accounts</h2><p>Create staff accounts with email and password, assign roles, and manage access.</p></div><button className="primary-button" onClick={() => { resetForm(); setShowForm(true); }}><Plus size={15}/> Add employee</button></div>
    {notice && <div className="employee-notice"><Check size={14}/>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={14}/></button></div>}
    {error && <div className="employee-error" role="alert">{error}</div>}
    {showForm && <form className="employee-form" onSubmit={submit}>
      <div className="employee-form-title"><b>{editing ? "Edit employee" : "Create employee account"}</b><button type="button" onClick={resetForm} aria-label="Close"><X size={16}/></button></div>
      <div className="employee-form-fields"><label>Full name *<input required value={name} onChange={event => setName(event.target.value)} placeholder="Employee name"/></label><label>Email address *<input required type="email" disabled={Boolean(editing)} value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com"/></label><PasswordField label={editing ? "New password (leave blank to keep current)" : "Initial password *"} required={!editing} minLength={8} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters"/><label>Role *<select value={role} onChange={event => setRole(event.target.value as AppRole)}>{roleOptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
      <p className="employee-form-note">No invitation email is sent. The employee can sign in with this email and password.</p>
      <div className="form-actions"><button type="button" className="cancel-button" onClick={resetForm}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving && <LoaderCircle className="spin" size={14}/>}<Check size={14}/>{editing ? "Save changes" : "Create account"}</button></div>
    </form>}
    <SearchableList className="employee-table-wrap"><table><thead><tr><th>EMPLOYEE</th><th>EMAIL / LOGIN ID</th><th>ROLE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>
      {employees.map(employee => <tr key={employee.id}><td><b>{employee.name}</b></td><td>{employee.loginId}</td><td>{roleOptions.find(item => item.id === employee.role)?.label}</td><td><span className={`employee-status ${employee.active ? "is-active" : "is-inactive"}`}>{employee.active ? "Active" : "Inactive"}</span></td><td><div className="employee-actions"><button title="Edit employee" onClick={() => edit(employee)}><Pencil size={14}/> Edit</button><button title={employee.active ? "Deactivate employee" : "Activate employee"} onClick={() => void changeActive(employee)}>{employee.active ? <ShieldCheck size={14}/> : <Check size={14}/>}</button><button disabled={saving} onClick={() => void remove(employee)}>Delete</button></div></td></tr>)}
    </tbody></table>{loading ? <div className="employee-empty"><LoaderCircle className="spin" size={22}/><span>Loading employee accounts…</span></div> : employees.length === 0 && <div className="employee-empty"><UserRoundPlus size={22}/><b>No employee accounts yet</b><span>Invite staff and assign one of the system roles.</span></div>}</SearchableList>
    <div className="employee-manager-foot">{employees.length} employee{employees.length === 1 ? "" : "s"} · Stored in Supabase · Admin can assign all seven roles</div>
  </section>;
}
