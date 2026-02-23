import { Pipe, PipeTransform } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import moment from 'moment';
import 'moment/locale/zh-cn';
import 'moment/locale/zh-tw';

/**
 * Moment.js based pipe to parse and return the provided date based on given params
 */
@Pipe({
    name: 'momentDate',
})
export class MomentDatePipe implements PipeTransform {
    constructor(private translate: TranslateService) {}

    transform(
        value: string,
        formatToParse: string,
        formatToReturn = 'MMMM Do, dddd'
    ): any {
        const lang = this.translate?.currentLang || 'en';
        const locale =
            lang === 'zh'
                ? 'zh-cn'
                : lang === 'zhtw'
                ? 'zh-tw'
                : lang;
        moment.locale(locale);
        return moment(value, formatToParse).format(formatToReturn);
    }
}
