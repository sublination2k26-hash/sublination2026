export function CustomerContact({name,phone}:{name:string;phone?:string}){return <span className="customer-contact"><b>{name}</b>{phone&&<small>{phone}</small>}</span>;}
