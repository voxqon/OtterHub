import { ApiPageShell } from "@/components/api/ApiPageShell";
import { FileApiPanel } from "@/components/settings/public-api-tab/FileApiPanel";

export default function ApiKeysPage() {
  return (
    <ApiPageShell active="keys">
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
        <FileApiPanel />
      </main>
    </ApiPageShell>
  );
}
