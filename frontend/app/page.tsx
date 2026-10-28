"use client";

import { useEffect } from "react";
import { FileUploadZone } from "@/components/FileUploadZone";
import { FileGallery } from "@/components/FileGallery";
import { BatchOperationsBar } from "@/components/batch-operations/BatchOperationsBar";
import { EmptyState } from "@/components/EmptyState";
import {
  useActiveItems,
  useActiveBucket,
  useFileDataStore,
  useFileUIStore,
  useHasAnySelection,
} from "@/stores/file";
import { ViewMode } from "@/lib/types";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { FloatingActionButton } from "@/components/FloatingActionButton";

export default function OtterHubPage() {
  const activeItems = useActiveItems();
  const bucket = useActiveBucket();
  const hasAnySelection = useHasAnySelection();

  const { fetchNextPage, refreshActiveBucket } = useFileDataStore();
  const { viewMode } = useFileUIStore();

  const isListOrGrid = [ViewMode.Grid, ViewMode.List].includes(viewMode);

  const showBatchBar = hasAnySelection && isListOrGrid;

  const isEmpty =
    activeItems.length === 0 &&
    bucket.initialized &&
    !bucket.loading &&
    !bucket.error &&
    !bucket.hasMore;

  useEffect(() => {
    fetchNextPage().catch((error) => {
      console.error("[OtterHubPage] fetch files failed:", error);
    });
  }, [fetchNextPage]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void refreshActiveBucket();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshActiveBucket]);

  return (
    <div className="relative min-h-screen bg-linear-to-br from-gradient-from via-gradient-via to-gradient-to overflow-x-hidden selection:bg-primary/20 selection:text-primary">
      {/* 极简精致的背景氛围光斑 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-[20%] -left-[10%] w-[50vw] h-[50vw] rounded-full bg-primary/10 blur-[130px] opacity-70 animate-pulse transition-opacity" style={{ animationDuration: "10s" }} />
        <div className="absolute top-[40%] -right-[15%] w-[45vw] h-[45vw] rounded-full bg-emerald-500/10 blur-[140px] opacity-60" />
        <div className="absolute -bottom-[10%] left-[20%] w-[40vw] h-[40vw] rounded-full bg-cyan-500/10 blur-[120px] opacity-50" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        <Header />

        <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 sm:px-6 md:px-8 md:py-8">
          <FileUploadZone />

          {isEmpty ? <EmptyState /> : <FileGallery />}
        </main>

        {showBatchBar && <BatchOperationsBar />}

        <FloatingActionButton />

        <Footer />
      </div>
    </div>
  );
}
