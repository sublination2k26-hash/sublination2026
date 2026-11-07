// Back/Forward can restore the login DOM without requesting it from middleware.
// Revalidate with Auth before returning a signed-in user to the workspace.
export function watchLoginSession(browser: Pick<Window,"location"|"addEventListener"|"removeEventListener">,
  verify: () => Promise<boolean>, onChecked: () => void) {
  let disposed=false;
  let pending=false;
  const check=async()=>{
    if(disposed||pending||browser.location.pathname!=="/login")return;
    pending=true;
    try {
      if(await verify() && !disposed && browser.location.pathname==="/login") {
        const next=new URLSearchParams(browser.location.search).get("next");
        browser.location.replace(next==="/scan-qr"?"/scan-qr":"/dashboard");
      }
    } catch { /* A failed check leaves the login form available for retry. */ }
    finally {pending=false;if(!disposed)onChecked();}
  };
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)void check();};
  browser.addEventListener("pageshow",restored);
  void check();
  return ()=>{disposed=true;browser.removeEventListener("pageshow",restored);};
}
