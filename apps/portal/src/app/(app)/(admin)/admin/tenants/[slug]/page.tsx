import { TenantDetail } from "./TenantDetail";

export const metadata = { title: "Tenant — Admin" };

export default async function AdminTenantDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  return <TenantDetail slug={params.slug} />;
}
