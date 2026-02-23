import { MomentDatePipe } from './moment-date.pipe';

describe('Pipe: MomentDatee', () => {
    it('create an instance', () => {
        const translateStub = { currentLang: 'en' } as any;
        const pipe = new MomentDatePipe(translateStub);
        expect(pipe).toBeTruthy();
    });
});
