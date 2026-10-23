import { spawnSync } from 'node:child_process';

/** @brief Linux seccomp launcher denies network syscalls before starting the permission-restricted Node worker. */
export const launcher = `import ctypes, ctypes.util, os, sys
lib = ctypes.CDLL(ctypes.util.find_library('seccomp') or 'libseccomp.so.2')
lib.seccomp_init.argtypes = [ctypes.c_uint32]
lib.seccomp_init.restype = ctypes.c_void_p
lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
lib.seccomp_load.argtypes = [ctypes.c_void_p]
lib.seccomp_release.argtypes = [ctypes.c_void_p]
ctx = lib.seccomp_init(0x7fff0000)
if not ctx: raise RuntimeError('seccomp initialization failed')
for name in ('socket','socketpair','connect','bind','listen','accept','accept4','sendto','recvfrom','ptrace','process_vm_readv','process_vm_writev'):
    syscall = lib.seccomp_syscall_resolve_name(name.encode())
    if syscall >= 0 and lib.seccomp_rule_add(ctx, 0x00050001, syscall, 0) != 0: raise RuntimeError('seccomp rule failed: ' + name)
if lib.seccomp_load(ctx) != 0: raise RuntimeError('seccomp filter could not be installed')
lib.seccomp_release(ctx)
os.execv(sys.argv[1], sys.argv[1:])
`;

/** @brief Refuse loading when the required process isolation cannot actually deny filesystem and networking. */
export function verifySandbox(python: string, timeoutMs = 10_000): void {
    if (process.platform !== 'linux') throw new Error('Intellisense PTC requires Linux seccomp; no unrestricted fallback is available');
    const probe = `const fs=require('node:fs');const net=require('node:net');let denied=false;try{fs.readFileSync('/etc/hostname')}catch(e){denied=e.code==='ERR_ACCESS_DENIED'}if(!denied)process.exit(2);const server=net.createServer();server.on('error',e=>{if(e.code==='EPERM'||e.code==='EACCES')process.stdout.write('SANDBOX_OK');else process.exitCode=3});server.listen(0,'127.0.0.1',()=>process.exit(4));`;
    const result = spawnSync(python, ['-c', launcher, process.execPath, '--permission', '--eval', probe], { env: {}, encoding: 'utf8', timeout: timeoutMs });
    if (result.status !== 0 || result.stdout !== 'SANDBOX_OK') throw new Error(`Intellisense PTC sandbox unavailable: ${result.error?.message ?? result.stderr ?? result.status}`);
}
