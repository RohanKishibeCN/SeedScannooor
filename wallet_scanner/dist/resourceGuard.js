import process from "node:process";
export const getMemoryUsageMb = () => process.memoryUsage().rss / (1024 * 1024);
export const checkMemoryLimit = (limitMb = 500) => getMemoryUsageMb() > limitMb;
