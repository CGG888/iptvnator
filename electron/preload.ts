import { Titlebar, TitlebarColor } from 'custom-electron-titlebar';

window.addEventListener('DOMContentLoaded', () => {
    const titlebar = new Titlebar({
        backgroundColor: TitlebarColor.fromHex('#f0f1f1'),
    });

    const applyThemeToTitlebar = () => {
        const isDark = document.body.classList.contains('dark-theme');
        const color = isDark ? '#1b1c1c' : '#f0f1f1';
        titlebar.updateBackground(TitlebarColor.fromHex(color));
    };

    applyThemeToTitlebar();
    const mo = new MutationObserver(applyThemeToTitlebar);
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
});
