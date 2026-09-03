import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { redirect?: string };
}) {
  const session = await getSession();
  if (session) redirect(searchParams.redirect || "/dashboard");
  return <LoginForm redirectTo={searchParams.redirect} />;
}
