import process from "node:process";

export const getMemoryUsageMb = (): number => process.memoryUsage().rss / (1024 * 1024);

export const checkMemoryLimit = (limitMb = 500): boolean => getMemoryUsageMb() > limitMb;

