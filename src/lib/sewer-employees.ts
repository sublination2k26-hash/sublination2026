type Employee = { id: string; full_name: string; role: string; active: boolean };

/** Use the employee roster, including sewers who have not received work yet. */
export function activeSewerEmployees<T extends Employee>(employees: T[]): T[] {
  return employees.filter(employee => employee.active && employee.role === "sewer")
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}
