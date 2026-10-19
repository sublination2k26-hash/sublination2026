export function calculateBalance(total:number,payments:number[]){return Math.max(0,Math.round((total-payments.reduce((sum,payment)=>sum+payment,0))*100)/100);}
export function isPaymentComplete(total:number,payments:number[]){return calculateBalance(total,payments)===0;}
