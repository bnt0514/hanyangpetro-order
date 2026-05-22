module.exports = {
    apps: [
        {
            name: 'hanyangpetro-ops',
            cwd: __dirname,
            script: './node_modules/next/dist/bin/next',
            args: 'start -H 0.0.0.0 -p 3000',
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                NODE_ENV: 'production',
                PORT: '3000',
            },
        },
    ],
};