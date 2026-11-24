// When the admin website shows a sidebar instead of the bottom tab bar, and
// which item is the current page. Pure TypeScript, tested by sidebar.test.ts.

// Windows at least this wide (in a web browser) get the sidebar.
export const SIDEBAR_MIN_WINDOW_WIDTH = 900;

export function showsSidebar(platform: string, windowWidth: number): boolean {
  return platform === "web" && windowWidth >= SIDEBAR_MIN_WINDOW_WIDTH;
}

// The item for tab `name` is current for its own path and anything below it.
// The tabs' index route is the path "/".
export function isCurrentTab(pathname: string, name: string): boolean {
  if (name === "index") return pathname === "/";
  return pathname === `/${name}` || pathname.startsWith(`/${name}/`);
}
