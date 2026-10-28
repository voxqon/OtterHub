export function createUploadQueue(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(upload: () => Promise<T>): Promise<T> => {
    if (active >= limit)
      await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await upload();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
