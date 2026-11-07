export function workspaceLocation(view: string, order: string | null) {
  const params = new URLSearchParams({ view });
  if (order) params.set("order", order);
  return `/dashboard?${params}`;
}

export function readWorkspaceLocation(search: string, fallback: string, allowed: readonly string[]) {
  const params = new URLSearchParams(search);
  const requested = params.get("view");
  return { view: requested && allowed.includes(requested) ? requested : fallback, order: params.get("order") };
}

export function createWorkspaceHistory(browser: Pick<Window,"history"|"location"|"addEventListener"|"removeEventListener">,
  fallback: string, allowed: readonly string[], receive: (state: {view:string;order:string|null}) => void) {
  let initialized = false;
  const restore = () => {
    if (browser.location.pathname === "/dashboard") receive(readWorkspaceLocation(browser.location.search,fallback,allowed));
  };
  browser.addEventListener("popstate",restore);
  return {
    sync(view: string, order: string | null) {
      const href=workspaceLocation(view,order);
      if (!initialized) {browser.history.replaceState(browser.history.state,"",href);initialized=true;}
      else if (browser.location.pathname+browser.location.search!==href) browser.history.pushState(browser.history.state,"",href);
    },
    dispose() {browser.removeEventListener("popstate",restore);},
  };
}
