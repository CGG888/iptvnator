module.exports = {
    extends: ['@commitlint/config-conventional'],
    ignores: [
        (message) => /^Merge /.test(message),
        (message) => /^Revert /.test(message),
    ],
    rules: {
        'body-max-line-length': [1, 'always', 200],
        'footer-max-line-length': [1, 'always', 200],
    },
};
