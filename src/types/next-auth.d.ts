import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** DB User id — set from the JWT `sub` claim in the session callback. */
      id: string;
    } & DefaultSession["user"];
  }
}
