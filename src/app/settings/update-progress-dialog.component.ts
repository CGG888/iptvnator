import { Component, ChangeDetectorRef } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonModule } from '@angular/material/button';
import { NgIf } from '@angular/common';

@Component({
  standalone: true,
  imports: [MatDialogModule, MatProgressBarModule, MatButtonModule, NgIf],
  template: `
    <h2 mat-dialog-title>更新</h2>
    <mat-dialog-content class="mat-typography">
      <div *ngIf="!done">
        <p>正在下载更新包，请勿关闭应用</p>
        <mat-progress-bar
          [mode]="!indeterminate ? 'determinate' : 'indeterminate'"
          [value]="progress"
        ></mat-progress-bar>
        <p *ngIf="!indeterminate">进度：{{ progress }}%（{{ pretty(received) }} / {{ pretty(total) }}）</p>
        <p *ngIf="indeterminate">已接收：{{ pretty(received) }}</p>
        <p>速度：{{ prettySpeed(speed) }}/s</p>
      </div>
      <div *ngIf="done">
        <p>下载完成。是否立即更新并重启安装程序？</p>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>关闭</button>
      <button
        mat-flat-button
        color="accent"
        *ngIf="done"
        (click)="installNow()"
      >
        更新
      </button>
    </mat-dialog-actions>
  `,
})
export class UpdateProgressDialogComponent {
  progress = 0;
  file = '';
  done = false;
  total = 0;
  received = 0;
  indeterminate = false;
  speed = 0;

  constructor(private ref: MatDialogRef<UpdateProgressDialogComponent>, private cdr: ChangeDetectorRef) {}

  update(payload: any) {
    if (typeof payload?.progress === 'number') this.progress = payload.progress;
    if (typeof payload?.total === 'number') this.total = payload.total;
    if (typeof payload?.received === 'number') this.received = payload.received;
    if (typeof payload?.indeterminate === 'boolean') this.indeterminate = payload.indeterminate;
    if (typeof payload?.speed === 'number') this.speed = payload.speed;
    this.cdr.detectChanges();
  }

  markDone(file: string) {
    this.done = true;
    this.file = file;
  }

  installNow() {
    this.ref.close({ action: 'install', file: this.file });
  }

  pretty(bytes: number) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(1)} ${units[i]}`;
  }

  prettySpeed(bps: number) {
    if (!bps || bps <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = bps;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(1)} ${units[i]}`;
  }
}
