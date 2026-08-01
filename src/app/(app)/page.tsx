import { redirect } from "next/navigation";

/**
 * The register is the home page. The link hub that used to live here — a
 * centred stack of underlined links plus a Sign out button — is now the shell's
 * rail and app bar, so this route has nothing left to render.
 *
 * No guard of its own is needed or wanted: the (app) layout's `requireRole` has
 * already run by the time this renders, and it redirects an unauthenticated
 * user and rejects a deactivated one — the same kill-switch this page used to
 * implement by hand. This component reads nothing and renders nothing, so there
 * is no authorisation decision left for it to make.
 */
export default function HomePage() {
  redirect("/assets");
}
