export function PaymentStatus({balance}:{balance:number}){return <span className={`payment ${balance<=0?"paid":"due-payment"}`}>{balance<=0?"Paid":"Balance due"}</span>;}
