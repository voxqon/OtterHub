import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ListFilesRequest, ViewMode } from "@/lib/types";
import { getFileList } from "@/lib/api";
import { getFileTypeFromKey } from "@/lib/utils/file";
import { useFileUIStore } from "./ui";
import {
  FileItem,
  FileMetadata,
  trashPrefix,
  FileType,
  TRASH_EXPIRATION_TTL,
} from "@shared/types";
import { storeKey } from "..";

type FileBucket = {
  items: FileItem[];
  cursor?: string;
  hasMore: boolean;
  loading: boolean;
  error: boolean;
  initialized: boolean;
  lastSyncedAt: number;
};

const recentChanges = new Map<string, { item: FileItem | null; at: number }>();
const rememberChange = (name: string, item: FileItem | null) => {
  for (const [key, change] of recentChanges) {
    if (Date.now() - change.at > 65_000) recentChanges.delete(key);
  }
  recentChanges.set(name, { item, at: Date.now() });
};

function applyRecentChanges(items: FileItem[], type: FileType): FileItem[] {
  const merged = new Map(items.map((item) => [item.name, item]));
  for (const [name, change] of recentChanges) {
    if (Date.now() - change.at > 65_000) {
      recentChanges.delete(name);
      continue;
    }
    if (getFileTypeFromKey(name) !== type) continue;
    if (change.item) merged.set(name, change.item);
    else merged.delete(name);
  }
  return [...merged.values()];
}

/**
 * 按文件名合并本地和服务端文件列表
 */
function mergeByName(local: FileItem[], remote: FileItem[]): FileItem[] {
  const map = new Map<string, FileItem>();
  for (const item of local) map.set(item.name, item);
  for (const item of remote) map.set(item.name, item);
  return Array.from(map.values());
}

interface FileDataState {
  activeType: FileType;
  buckets: Record<FileType, FileBucket>;

  // actions
  setActiveType: (type: FileType) => Promise<void>;
  fetchNextPage: () => Promise<void>;
  fetchBucket: (type: FileType, refresh?: boolean) => Promise<void>;
  refreshActiveBucket: () => Promise<void>;

  addFileLocal: (file: FileItem, fileType: FileType) => void;
  deleteFilesLocal: (names: string[]) => void;
  deleteFilesLocalByType: (names: string[], type: FileType) => void;
  moveToTrashLocal: (file: FileItem) => Promise<void>;
  restoreFromTrashLocal: (file: FileItem) => Promise<void>;
  updateFileMetadata: (name: string, metadata: FileMetadata) => void;
}

const emptyBucket = (): FileBucket => ({
  items: [],
  cursor: undefined,
  hasMore: true,
  loading: false,
  error: false,
  initialized: false,
  lastSyncedAt: 0,
});

export const useFileDataStore = create<FileDataState>()(
  persist(
    (set, get) => ({
      activeType: FileType.Image,
      buckets: {
        [FileType.Image]: emptyBucket(),
        [FileType.Audio]: emptyBucket(),
        [FileType.Video]: emptyBucket(),
        [FileType.Document]: emptyBucket(),
        [FileType.Trash]: emptyBucket(),
      },

      setActiveType: async (type) => {
        const { activeType } = get();
        const { viewMode } = useFileUIStore.getState();
        if (
          activeType === FileType.Image &&
          type !== FileType.Image &&
          viewMode === ViewMode.Masonry
        ) {
          useFileUIStore.setState({ viewMode: ViewMode.Grid });
        }
        set({ activeType: type });
        if (type !== activeType) useFileUIStore.getState().setCurrentPage(0);

        // 如果从未加载过数据，触发一次分页加载
        const bucket = get().buckets[type];
        if (!bucket.initialized) {
          await get().fetchNextPage();
        } else {
          await get().refreshActiveBucket();
        }
      },

      fetchNextPage: async () => {
        const { activeType } = get();
        await get().fetchBucket(activeType);
      },

      refreshActiveBucket: async () => {
        const { activeType, buckets } = get();
        if (Date.now() - buckets[activeType].lastSyncedAt < 15_000) return;
        await get().fetchBucket(activeType, true);
      },

      fetchBucket: async (type, refresh = false) => {
        const { buckets } = get();
        const bucket = buckets[type];

        if (bucket.loading || (!refresh && !bucket.hasMore)) return;

        set((state) => ({
          buckets: {
            ...state.buckets,
            [type]: { ...bucket, loading: true, error: false },
          },
        }));

        try {
          const { itemsPerPage } = useFileUIStore.getState();
          const params: ListFilesRequest = {
            fileType: type,
            limit: (refresh
              ? Math.min(1000, Math.max(itemsPerPage, bucket.items.length))
              : itemsPerPage
            ).toString(),
          };
          if (!refresh && bucket.cursor) params.cursor = bucket.cursor;

          const data = await getFileList(params);

          set((state) => {
            const prev = state.buckets[type];
            const preserveTail = refresh && bucket.items.length > 1000;
            const items =
              (!refresh && bucket.initialized) || preserveTail
                ? mergeByName(prev.items, data.keys)
                : data.keys;
            return {
              buckets: {
                ...state.buckets,
                [type]: {
                  items: applyRecentChanges(items, type),
                  cursor: preserveTail ? prev.cursor : data.cursor,
                  hasMore: preserveTail ? prev.hasMore : !data.list_complete,
                  loading: false,
                  error: false,
                  initialized: true,
                  lastSyncedAt: Date.now(),
                },
              },
            };
          });
        } catch (error) {
          console.error(`Failed to fetch bucket ${type}:`, error);
          set((state) => ({
            buckets: {
              ...state.buckets,
              [type]: { ...state.buckets[type], loading: false, error: true },
            },
          }));
        }
      },

      addFileLocal: (file, fileType) => {
        rememberChange(file.name, file);
        set((state) => ({
          buckets: {
            ...state.buckets,
            [fileType]: {
              ...state.buckets[fileType],
              items: mergeByName(state.buckets[fileType].items, [file]),
            },
          },
        }));
      },

      moveToTrashLocal: async (file: FileItem) => {
        const fileType = getFileTypeFromKey(file.name);
        get().deleteFilesLocalByType([file.name], fileType);
        get().addFileLocal(
          {
            ...file,
            name: trashPrefix + file.name,
            expiration: Math.floor(Date.now() / 1000) + TRASH_EXPIRATION_TTL,
          },
          FileType.Trash
        );
      },

      restoreFromTrashLocal: async (file: FileItem) => {
        const originalKey = file.name.startsWith(trashPrefix)
          ? file.name.slice(trashPrefix.length)
          : file.name;
        const originalType = getFileTypeFromKey(originalKey);
        get().deleteFilesLocalByType([file.name], FileType.Trash);
        const { expiration: _expiration, ...restored } = file;
        get().addFileLocal({ ...restored, name: originalKey }, originalType);
      },

      deleteFilesLocal: (names: string[]) =>
        set((state) => {
          names.forEach((name) => rememberChange(name, null));
          // 1. 更新 buckets
          const newBuckets = Object.entries(state.buckets).reduce(
            (acc, [type, bucket]) => {
              acc[type as FileType] = {
                ...bucket,
                items: bucket.items.filter(
                  (item) => !names.includes(item.name)
                ),
              };
              return acc;
            },
            {} as Record<FileType, FileBucket>
          );

          // 2. 同步清理 selection
          const { selectedKeys } = useFileUIStore.getState();
          const newSelectedKeys = Object.entries(selectedKeys).reduce(
            (acc, [type, keys]) => {
              acc[type as FileType] = keys.filter(
                (key) => !names.includes(key)
              );
              return acc;
            },
            {} as Record<FileType, string[]>
          );
          useFileUIStore.setState({ selectedKeys: newSelectedKeys });

          return { buckets: newBuckets };
        }),

      deleteFilesLocalByType: (names: string[], type: FileType) =>
        set((state) => {
          names.forEach((name) => rememberChange(name, null));
          // 1. 更新指定类型的 bucket
          const newBuckets = {
            ...state.buckets,
            [type]: {
              ...state.buckets[type],
              items: state.buckets[type].items.filter(
                (item) => !names.includes(item.name)
              ),
            },
          };

          // 2. 同步清理该类型的 selection
          const { selectedKeys } = useFileUIStore.getState();
          const currentSelection = selectedKeys[type] || [];
          const newSelectedKeys = {
            ...selectedKeys,
            [type]: currentSelection.filter((key) => !names.includes(key)),
          };
          useFileUIStore.setState({ selectedKeys: newSelectedKeys });

          return { buckets: newBuckets };
        }),

      updateFileMetadata: (name, metadata) =>
        set((state) => {
          const newBuckets = Object.entries(state.buckets).reduce(
            (acc, [type, bucket]) => {
              acc[type as FileType] = {
                ...bucket,
                items: bucket.items.map((item) => {
                  if (item.name !== name) return item;
                  const updated = { ...item, metadata };
                  rememberChange(name, updated);
                  return updated;
                }),
              };
              return acc;
            },
            {} as Record<FileType, FileBucket>
          );
          return { buckets: newBuckets };
        }),
    }),
    {
      name: storeKey.FileData,
      partialize: (state) => ({
        activeType: state.activeType,
      }),
    }
  )
);

export const useActiveBucket = () =>
  useFileDataStore((s) => s.buckets[s.activeType]);

export const useActiveItems = () =>
  useFileDataStore((s) => s.buckets[s.activeType].items);

export const useBucketItems = (type: FileType) =>
  useFileDataStore((s) => s.buckets[type].items);

/** 获取所有 buckets（用于跨类型操作） */
export const useFileBuckets = () => useFileDataStore((s) => s.buckets);
