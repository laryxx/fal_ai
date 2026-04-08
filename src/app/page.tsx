import { AuthScreen } from "@/components/auth-screen";
import { DashboardApp } from "@/components/dashboard-app";
import { readSession } from "@/lib/auth/session";
import { loadAppData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await readSession();
  const data = await loadAppData(session);

  if (data.authenticated) {
    return <DashboardApp initialData={data} />;
  }

  return <AuthScreen initialData={data} />;
}
