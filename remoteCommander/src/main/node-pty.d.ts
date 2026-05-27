// Minimal type declarations for node-pty (optional native dep — may be absent
// when no C/C++ toolchain is available to build it; loaded lazily at runtime).
declare module 'node-pty' {
  export interface IPty {
    onData(cb: (data: string) => void): void
    onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
    write(data: string): void
    resize(cols: number, rows: number): void
    kill(signal?: string): void
  }
  export interface IPtyForkOptions {
    name?: string
    cols?: number
    rows?: number
    cwd?: string
    env?: { [key: string]: string | undefined }
  }
  export function spawn(file: string, args: string[] | string, options: IPtyForkOptions): IPty
}
