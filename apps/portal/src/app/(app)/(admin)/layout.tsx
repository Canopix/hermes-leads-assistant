import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const role = (session.user as { role?: string }).role;
  if (role !== "super_admin") redirect("/dashboard");
  return <>{children}</>;
}
