declare module 'tar' {
  export function create(
    options: {
      gzip?: boolean
      file: string
      cwd?: string
    },
    files: string[]
  ): Promise<void>
}
