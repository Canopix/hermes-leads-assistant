import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function SignupPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");
  return <SignupForm />;
}
