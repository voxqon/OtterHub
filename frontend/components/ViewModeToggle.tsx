"use client"

import { Grid3x3, LayoutTemplate, List } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useFileDataStore } from "@/stores/file"
import { useFileUIStore } from "@/stores/file"
import { cn } from "@/lib/utils"
import { ViewMode } from "@/lib/types"
import { FileType } from "@shared/types"

export function ViewModeToggle() {
  const { viewMode, setViewMode } = useFileUIStore()
  const activeType = useFileDataStore((state) => state.activeType)

  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-secondary/30 border border-glass-border/70 backdrop-blur-md">
      {activeType === FileType.Image && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setViewMode(ViewMode.Masonry)}
          className={cn(
            "h-7.5 px-2.5 rounded-lg transition-all duration-200",
            viewMode === ViewMode.Masonry
              ? "bg-primary text-primary-foreground shadow-xs shadow-primary/25 hover:bg-primary/90 hover:text-primary-foreground"
              : "text-foreground/60 hover:text-foreground hover:bg-secondary/60",
          )}
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setViewMode(ViewMode.Grid)}
        className={cn(
          "h-7.5 px-2.5 rounded-lg transition-all duration-200",
          viewMode === ViewMode.Grid
            ? "bg-primary text-primary-foreground shadow-xs shadow-primary/25 hover:bg-primary/90 hover:text-primary-foreground"
            : "text-foreground/60 hover:text-foreground hover:bg-secondary/60",
        )}
      >
        <Grid3x3 className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setViewMode(ViewMode.List)}
        className={cn(
          "h-7.5 px-2.5 rounded-lg transition-all duration-200",
          viewMode === ViewMode.List
            ? "bg-primary text-primary-foreground shadow-xs shadow-primary/25 hover:bg-primary/90 hover:text-primary-foreground"
            : "text-foreground/60 hover:text-foreground hover:bg-secondary/60",
        )}
      >
        <List className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
