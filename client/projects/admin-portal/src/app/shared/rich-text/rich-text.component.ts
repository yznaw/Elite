import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../services/i18n.service';

/**
 * Lightweight rich-text editor backed by a contenteditable element.
 *
 * Emits the editor's HTML on every input. Supports a minimal toolbar:
 * heading toggle, bold, italic, underline, bullet list, ordered list, clear
 * formatting, and link insertion. Honours `dir` for RTL editing.
 *
 * No external dependency — uses `document.execCommand` (works fine for the
 * small surface this prototype needs; ready to be swapped for TipTap/Quill
 * later without changing the public API of this component).
 */
@Component({
  selector: 'ap-rich-text',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rt" [class.rt-rtl]="dir === 'rtl'">
      <div class="rt-toolbar" role="toolbar">
        <button type="button" class="rt-btn" (mousedown)="cmd($event, 'formatBlock', 'h3')"
                [attr.aria-label]="t('richtext.heading')" [attr.title]="t('richtext.heading')">H</button>
        <span class="rt-sep"></span>
        <button type="button" class="rt-btn rt-bold"  (mousedown)="cmd($event, 'bold')"
                [attr.aria-label]="t('richtext.bold')" [attr.title]="t('richtext.bold')">B</button>
        <button type="button" class="rt-btn rt-italic"  (mousedown)="cmd($event, 'italic')"
                [attr.aria-label]="t('richtext.italic')" [attr.title]="t('richtext.italic')">I</button>
        <button type="button" class="rt-btn rt-underline"  (mousedown)="cmd($event, 'underline')"
                [attr.aria-label]="t('richtext.underline')" [attr.title]="t('richtext.underline')">U</button>
        <span class="rt-sep"></span>
        <button type="button" class="rt-btn"  (mousedown)="cmd($event, 'insertUnorderedList')"
                [attr.aria-label]="t('richtext.bulletList')" [attr.title]="t('richtext.bulletList')">•</button>
        <button type="button" class="rt-btn"  (mousedown)="cmd($event, 'insertOrderedList')"
                [attr.aria-label]="t('richtext.orderedList')" [attr.title]="t('richtext.orderedList')">1.</button>
        <span class="rt-sep"></span>
        <button type="button" class="rt-btn"  (mousedown)="onLink($event)"
                [attr.aria-label]="t('richtext.link')" [attr.title]="t('richtext.link')">↗</button>
        <button type="button" class="rt-btn"  (mousedown)="cmd($event, 'removeFormat')"
                [attr.aria-label]="t('richtext.clear')" [attr.title]="t('richtext.clear')">⨉</button>
      </div>
      <div #editor
           class="rt-editor"
           contenteditable="true"
           [attr.dir]="dir || null"
           [attr.aria-label]="ariaLabel || null"
           [attr.data-placeholder]="placeholder || null"
           (input)="onInput()"
           (blur)="onInput()">
      </div>
    </div>
  `,
  styles: [`
    .rt {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #fff;
      overflow: hidden;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .rt:focus-within {
      border-color: var(--gold);
      box-shadow: 0 0 0 3px rgba(193, 154, 91, 0.15);
    }
    .rt-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 2px;
      padding: 6px 8px;
      background: var(--bg);
      border-bottom: 1px solid var(--border-2);
    }
    .rt-btn {
      min-width: 28px;
      height: 28px;
      padding: 0 6px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--ink-2);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.12s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .rt-btn:hover {
      background: #fff;
      border-color: var(--border);
      color: var(--green);
    }
    .rt-btn:active {
      background: var(--gold-3, var(--bg));
    }
    .rt-bold { font-weight: 700; }
    .rt-italic { font-style: italic; font-family: var(--ff-ui); }
    .rt-underline { text-decoration: underline; }
    .rt-sep {
      width: 1px;
      height: 18px;
      background: var(--border);
      margin: 0 4px;
    }
    .rt-editor {
      min-height: 110px;
      max-height: 320px;
      overflow: auto;
      padding: 12px 14px;
      outline: none;
      font-size: 14px;
      line-height: 1.6;
      color: var(--ink);
    }
    .rt-editor:empty::before {
      content: attr(data-placeholder);
      color: var(--muted);
      pointer-events: none;
    }
    .rt-editor h3 { font-family: var(--ff-disp); font-size: 16px; margin: 8px 0 6px; color: var(--green); }
    .rt-editor ul, .rt-editor ol { padding-inline-start: 22px; margin: 6px 0; }
    .rt-editor a { color: var(--green); text-decoration: underline; }
    .rt-editor p { margin: 4px 0; }
    .rt-editor strong { color: var(--ink); }
    .rt-rtl .rt-editor { text-align: right; }
  `],
})
export class RichTextComponent implements AfterViewInit, OnChanges {
  @Input() value = '';
  @Input() placeholder = '';
  @Input() ariaLabel = '';
  @Input() dir: 'ltr' | 'rtl' | null = null;
  @Output() valueChange = new EventEmitter<string>();

  @ViewChild('editor', { static: true }) editor!: ElementRef<HTMLDivElement>;

  private readonly i18n = inject(I18nService);
  readonly t = (k: string): string => this.i18n.t(k);

  /** Tracks whether the most recent inner-HTML change came from the user
      typing — if so we skip overwriting it from the @Input setter. */
  private syncing = false;

  ngAfterViewInit(): void {
    this.write(this.value ?? '');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.editor) return;
    if (changes['value'] && !this.syncing) {
      const incoming = (this.value ?? '');
      if (this.editor.nativeElement.innerHTML !== incoming) {
        this.write(incoming);
      }
    }
  }

  private write(html: string): void {
    this.editor.nativeElement.innerHTML = html || '';
  }

  onInput(): void {
    const html = this.editor.nativeElement.innerHTML.trim();
    this.syncing = true;
    this.valueChange.emit(html);
    queueMicrotask(() => { this.syncing = false; });
  }

  /** Run a contenteditable command on the current selection. We swallow the
      mousedown to keep the editor focused (otherwise the toolbar steals it
      and the selection collapses). */
  cmd(ev: Event, command: string, arg?: string): void {
    ev.preventDefault();
    this.editor.nativeElement.focus();
    document.execCommand(command, false, arg);
    this.onInput();
  }

  onLink(ev: Event): void {
    ev.preventDefault();
    this.editor.nativeElement.focus();
    const url = window.prompt(this.t('richtext.linkPrompt'), 'https://');
    if (url) {
      document.execCommand('createLink', false, url);
      this.onInput();
    }
  }
}
