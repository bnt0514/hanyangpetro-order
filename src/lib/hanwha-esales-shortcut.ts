import { spawn } from 'child_process';

const DEFAULT_HANWHA_ESALES_SHORTCUT_PATH = 'C:\\Users\\Owner\\Desktop\\한화솔루션 e-Sales.lnk';

export type HanwhaESalesShortcutResult =
    | { ok: true; message: string; shortcutPath: string }
    | { ok: false; error: string; shortcutPath: string };

function powershellQuote(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
}

function hanwhaESalesShortcutPath() {
    return process.env.HANWHA_ESALES_SHORTCUT_PATH?.trim() || DEFAULT_HANWHA_ESALES_SHORTCUT_PATH;
}

export async function openHanwhaESalesShortcut(): Promise<HanwhaESalesShortcutResult> {
    const shortcutPath = hanwhaESalesShortcutPath();

    if (process.platform !== 'win32') {
        return {
            ok: false,
            shortcutPath,
            error: '한화 e-Sales 바로가기는 Windows 업무 PC에서만 열 수 있습니다.',
        };
    }

    return new Promise((resolve) => {
        const command = [
            `$shortcut = ${powershellQuote(shortcutPath)}`,
            'if (-not (Test-Path -LiteralPath $shortcut)) { $desktop = [Environment]::GetFolderPath("Desktop"); $found = Get-ChildItem -LiteralPath $desktop -Filter "*e-Sales.lnk" | Select-Object -First 1; if ($found) { $shortcut = $found.FullName } else { Write-Error "Shortcut not found: $shortcut"; exit 2 } }',
            '$wsh = New-Object -ComObject WScript.Shell',
            '$wsh.Run(\'"\' + $shortcut + \'"\', 1, $false) | Out-Null',
        ].join('; ');

        const child = spawn(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-Command',
                command,
            ],
            { windowsHide: true },
        );

        let stderr = '';
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });

        child.on('error', (error) => {
            resolve({
                ok: false,
                shortcutPath,
                error: `한화 e-Sales 바로가기 실행 중 오류가 발생했습니다. (${error.message})`,
            });
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve({
                    ok: true,
                    shortcutPath,
                    message: '한화 e-Sales 바로가기를 열었습니다. 새 화면에서 주문을 진행해주세요.',
                });
                return;
            }

            const detail = stderr.trim();
            const notFoundMessage = code === 2
                ? `한화 e-Sales 바로가기를 찾을 수 없습니다. 경로를 확인해주세요: ${shortcutPath}`
                : null;
            resolve({
                ok: false,
                shortcutPath,
                error: notFoundMessage ?? `한화 e-Sales 바로가기 실행에 실패했습니다.${detail ? ` (${detail.slice(0, 300)})` : ''}`,
            });
        });
    });
}
