/**
 * FileSystemPort — 文件系统接口
 *
 * 核心引擎通过此接口操作工作区文件。
 * 不关心底层是 node:fs、DSH ctx.fs 还是远程沙箱。
 */

export interface FileSystemPort {
  /** 创建目录（含父目录） */
  createDirectory(path: string): Promise<void>
  /** 递归删除目录 */
  removeDirectory(path: string): Promise<void>
  /** 读取文件内容 */
  readFile(path: string): Promise<string>
  /** 写入文件 */
  writeFile(path: string, content: string): Promise<void>
  /** 检查路径是否存在 */
  exists(path: string): Promise<boolean>
  /** glob 查找文件 */
  glob(pattern: string, cwd: string): Promise<string[]>
  /** 获取 git diff 输出 */
  getDiff(cwd: string, staged?: boolean): Promise<string>
  /** 列出目录内容 */
  listDirectory(path: string): Promise<string[]>
}
