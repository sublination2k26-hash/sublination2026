"use server";
// Production mutations move here when the local-first store is replaced by a shared backend.
export async function saveProductionDraft(){return {ok:false as const,message:"Production server actions are not connected yet."};}
