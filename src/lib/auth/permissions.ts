export type AppRole="admin"|"front_desk"|"artist"|"printing"|"heat_press"|"cutting_sewing"|"qc";
export const APP_ROLES: AppRole[]=["admin","front_desk","artist","printing","heat_press","cutting_sewing","qc"];
export function canAccessRoleWorkspace(currentRole:AppRole,workspaceRole:AppRole){return currentRole==="admin"||currentRole===workspaceRole;}
export function canManageEmployees(role:AppRole){return role==="admin";}
export function canManagePrices(role:AppRole){return role==="admin";}
export function canManageOrders(role:AppRole){return role==="admin"||role==="front_desk";}
export function canRecordPayments(role:AppRole){return role==="admin"||role==="front_desk";}
export function canManageCustomers(role:AppRole){return role==="admin"||role==="front_desk";}
export function canUpdateProductionStage(role:AppRole,stage:string){return role==="admin"||(stage==="layout"&&role==="artist")||(stage==="printing"&&role==="printing")||(stage==="heat_press"&&role==="heat_press")||((stage==="cutting"||stage==="sewing")&&role==="cutting_sewing")||(stage==="qc"&&role==="qc");}
