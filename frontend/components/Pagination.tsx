"use client";

import ReactPaginate from "react-paginate";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Ellipsis,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Props {
  totalItems: number;
  itemsPerPage: number;
  currentPage: number;
  hasMore: boolean;
  loading: boolean;
  error?: boolean;
  onPageChange: (selectedItem: { selected: number }) => void;
  onLoadMore: () => void;
  onItemsPerPageChange: (size: number) => void;
  showPagination?: boolean;
  className?: string;
}

const ITEMS_PER_PAGE_OPTIONS = [20, 50, 100, 200, 1000];

export function Pagination({
  totalItems,
  itemsPerPage,
  currentPage,
  hasMore,
  loading,
  error,
  onPageChange,
  onLoadMore,
  onItemsPerPageChange,
  className,
}: Props) {
  const pageCount = Math.max(1, Math.ceil(totalItems / itemsPerPage));

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-6 py-8 flex-wrap",
        className
      )}
    >
      <ReactPaginate
        breakLabel="..."
        nextLabel={<ChevronRight className="h-4 w-4" />}
        onPageChange={onPageChange}
        pageRangeDisplayed={5}
        pageCount={pageCount}
        previousLabel={<ChevronLeft className="h-4 w-4" />}
        renderOnZeroPageCount={null}
        containerClassName="flex items-center gap-1"
        pageClassName="flex items-center justify-center"
        pageLinkClassName="min-w-[36px] h-9 flex items-center justify-center rounded-md text-sm text-foreground/80 hover:bg-secondary/50 transition-colors"
        previousClassName="flex items-center justify-center"
        previousLinkClassName="min-w-[36px] h-9 flex items-center justify-center rounded-md text-sm text-foreground/80 hover:bg-secondary/50 transition-colors px-3"
        nextClassName="flex items-center justify-center"
        nextLinkClassName="min-w-[36px] h-9 flex items-center justify-center rounded-md text-sm text-foreground/80 hover:bg-secondary/50 transition-colors px-3"
        breakClassName="flex items-center justify-center"
        breakLinkClassName="min-w-[36px] h-9 flex items-center justify-center text-foreground/60"
        activeClassName="bg-primary/20 text-primary font-medium"
        disabledClassName="opacity-50 cursor-not-allowed"
        forcePage={currentPage}
      />

      {hasMore && (
        <Button
          onClick={onLoadMore}
          disabled={loading}
          variant="ghost"
          size="sm"
          title={loading ? "加载中" : error ? "重试" : "加载更多"}
          className="h-9 min-w-[36px] px-3 border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : error ? (
            <CircleAlert className="h-4 w-4" />
          ) : (
            <Ellipsis className="h-4 w-4" />
          )}
        </Button>
      )}

      <>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-secondary/30 border border-glass-border">
          <span className="text-xs text-foreground/50">每页</span>
          <Select
            value={itemsPerPage.toString()}
            onValueChange={(value) => onItemsPerPageChange(Number(value))}
          >
            <SelectTrigger className="h-7 w-16 bg-transparent border-0 text-foreground/80 text-xs shadow-none focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {ITEMS_PER_PAGE_OPTIONS.map((size) => (
                <SelectItem key={size} value={size.toString()} className="text-xs">
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-foreground/50">
          <span>共</span>
          <span className="text-primary font-semibold">{totalItems}</span>
          <span>个文件</span>
        </div>
      </>
    </div>
  );
}
