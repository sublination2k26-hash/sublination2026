export function formatCurrency(amount:number,currency="PHP"){return new Intl.NumberFormat("en-PH",{style:"currency",currency,maximumFractionDigits:2}).format(amount);}
export function todayISO(){return new Date().toISOString().slice(0,10);}
