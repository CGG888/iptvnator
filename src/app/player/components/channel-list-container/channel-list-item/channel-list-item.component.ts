import { DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { DataService } from '../../../../services/data.service';
import { CACHE_LOGO, CACHE_LOGO_RESPONSE } from '../../../../../../shared/ipc-commands';

@Component({
    standalone: true,
    selector: 'app-channel-list-item',
    styleUrls: ['./channel-list-item.component.scss'],
    template: `<mat-list-item
        cdkDrag
        [cdkDragDisabled]="!isDraggable"
        cdkDragPreviewContainer="parent"
        [class.active]="selected"
        (click)="clicked.emit()"
        [matTooltip]="tooltip"
        [matTooltipClass]="'epg-tip'"
        data-test-id="channel-item"
    >
        <div class="channel-item-layout">
            <!-- Drag Handle -->
            <mat-icon
                *ngIf="isDraggable"
                cdkDragHandle
                class="drag-icon"
                >drag_indicator</mat-icon
            >
            
            <!-- Logo -->
            <img
                class="channel-logo"
                [src]="cachedLogo || logo || defaultLogo"
                (error)="onImgError($event)"
            />

            <!-- Text Content -->
            <div class="text-container">
                <div class="channel-name">{{ name }}</div>
                <div class="program-line" *ngIf="group || programTitle">
                    <span *ngIf="group">{{ group }}</span>
                    <span *ngIf="group && programTitle" class="separator">·</span>
                    <span *ngIf="programTitle" class="program-title">{{ programTitle }}</span>
                </div>
            </div>

            <!-- Badges (Fixed Right) -->
            <div class="badges">
                <span
                    *ngIf="hasReplay"
                    class="badge-replay"
                    [matTooltip]="'COMMON.REPLAY_TOOLTIP' | translate"
                >R</span>
                <span
                    *ngIf="showFavoriteButton"
                    class="inline-star"
                    [matTooltip]="(isFavorite ? 'CHANNELS.REMOVE_FAVORITE' : 'TOP_MENU.TOGGLE_FAVORITE_FLAG') | translate"
                    (click)="onFavoriteClick($event)"
                >
                    <mat-icon color="accent">{{ isFavorite ? 'star' : 'star_outline' }}</mat-icon>
                </span>
            </div>
        </div>
    </mat-list-item>`,
    imports: [
        CommonModule,
        DragDropModule,
        MatButtonModule,
        MatIconModule,
        MatListModule,
        MatTooltipModule,
        TranslateModule,
    ],
})
export class ChannelListItemComponent implements OnChanges {
    @Input() isDraggable = false;
    @Input() logo!: string;
    @Input() name = '';
    @Input() showFavoriteButton = false;
    @Input() selected = false;
    @Input() isFavorite = false;
    @Input() group = '';
    @Input() programTitle = '';
    @Input() hasReplay = false;
    @Input() tooltip = '';

    @Output() clicked = new EventEmitter<void>();
    @Output() favoriteToggled = new EventEmitter();

    defaultLogo = './assets/icons/icon-tv-256.png';
    cachedLogo: string | null = null;

    constructor(private electronService: DataService, private cdr: ChangeDetectorRef) {}

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['logo'] && this.logo && this.logo.startsWith('http')) {
             this.requestCachedLogo(this.logo);
        }
    }

    requestCachedLogo(url: string) {
        if (this.electronService.isElectron) {
            this.electronService.sendIpcEvent(CACHE_LOGO, url);
        }
    }

    ngOnInit() {
        if (this.electronService.isElectron) {
            this.electronService.listenOn(CACHE_LOGO_RESPONSE, (_event, args) => {
                if (args && args.original === this.logo && args.url) {
                    this.cachedLogo = args.url;
                    this.cdr.detectChanges();
                }
            });
            // Initial request
            if (this.logo && this.logo.startsWith('http')) {
                this.requestCachedLogo(this.logo);
            }
        }
    }

    onImgError(ev: Event) {
        const img = ev.target as HTMLImageElement;
        // If cached logo fails, try original logo as fallback, then default
        if (this.cachedLogo && img.src === this.cachedLogo) {
             this.cachedLogo = null;
             img.src = this.logo || this.defaultLogo;
             return;
        }

        if (img && img.src !== this.defaultLogo) {
            img.src = this.defaultLogo;
        }
    }

    onFavoriteClick(ev: MouseEvent) {
        ev.stopPropagation();
        this.favoriteToggled.emit(ev);
    }
}
