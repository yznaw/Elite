import { Component, OnInit, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HomeContentService } from '../../services/home-content.service';
import { LocaleService } from '../../services/locale.service';
import { I18nService } from '../../services/i18n.service';
import { SeoService } from '../../services/seo.service';

@Component({
    selector: 'cw-story',
    imports: [CommonModule],
    templateUrl: './story.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrl: './story.component.scss'
})
export class StoryComponent implements OnInit {
  private readonly homeContent = inject(HomeContentService);
  private readonly i18n = inject(I18nService);
  private readonly seo = inject(SeoService);
  readonly locale = inject(LocaleService);

  private readonly seoTags = this.seo.watch(() => ({
    title: this.i18n.t('seo.story.title'),
    description: this.i18n.t('seo.story.description'),
    canonicalPath: '/story',
    type: 'article' as const,
  }));

  readonly content  = computed(() => this.homeContent.contentData().story);
  readonly chapters = computed(() => this.content().chapters);

  localized(en: string | undefined, ar: string | undefined, legacy = ''): string {
    return (this.locale.locale() === 'ar' ? ar : en)?.trim() || legacy;
  }

  localizedImageAlt(en: string | undefined, ar: string | undefined, legacy = ''): string {
    const localizedAlt = this.localized(en, ar);
    if (localizedAlt) return localizedAlt;
    if (this.locale.locale() !== 'ar' && legacy.trim()) return legacy.trim();
    return this.locale.locale() === 'ar'
      ? 'قطعة جلدية من إيليت كولكشن منفّذة بعناية'
      : 'An Elite Collection leather piece, crafted with care';
  }

  ngOnInit(): void {
    void this.homeContent.refresh(true);
  }

  onImgError(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }
}
