import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
import { catchError, map, Observable } from 'rxjs';
import { STORE_KEY } from '../shared/enums/store-keys.enum';
import { Theme } from './../settings/theme.enum';

/** GitHub API endpoint for latest release */
const RELEASES_API_URL =
    'https://api.github.com/repos/CGG888/iptvnator/releases/latest';
/** Fallback url of package.json in repo (in case API is blocked) */
const PACKAGE_JSON_URL =
    'https://raw.githubusercontent.com/CGG888/iptvnator/electron/package.json';

@Injectable({
    providedIn: 'root',
})
export class SettingsService {
    /** Creates an instance of SettingsService */
    constructor(
        private http: HttpClient,
        private storage: StorageMap
    ) {}

    /**
     * Changes the visual theme of the application
     * @param selectedTheme theme to set
     */
    changeTheme(selectedTheme: Theme): void {
        if (selectedTheme === Theme.LightTheme) {
            document.body.classList.remove('dark-theme');
        } else if (selectedTheme === Theme.DarkTheme) {
            document.body.classList.add('dark-theme');
        }
    }

    /**
     * Returns the value of the given key from the local storage
     * @param key key to get
     * @returns returns the value of the given key
     */
    getValueFromLocalStorage(key: STORE_KEY) {
        return this.storage.get(key);
    }

    /**
     * Sets the given key/value pair in the local storage
     * @param key key to set
     * @param value value to set
     * @param withCallback if true, the callback will be called after the value is set
     */
    setValueToLocalStorage(
        key: STORE_KEY,
        value: unknown,
        withCallback = false
    ): Observable<unknown> | never {
        if (withCallback) {
            return this.storage.set(key, value);
        } else {
            this.storage.set(key, value).subscribe(() => {});
        }
    }

    /**
     * Returns the latest released app version ("库版本")
     * Primary: GitHub Releases API; Fallback: package.json in repo
     */
    getAppVersion() {
        return this.http.get<any>(RELEASES_API_URL, {
            headers: { Accept: 'application/vnd.github+json' },
        }).pipe(
            map((response) => {
                const v = response?.tag_name || response?.name || '';
                return String(v).replace(/^v/i, '');
            }),
            catchError(() =>
                this.http.get<{ version: string }>(PACKAGE_JSON_URL).pipe(
                    map((response) => response.version)
                )
            )
        );
    }
}
