import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../services/i18n.service';

interface Chapter {
  year: string;
  titleKey: string;
  bodyKey: string;
  image: string;
  align: 'left' | 'right';
}

interface Master {
  roleKey: string;
  years: number;
}

@Component({
  selector: 'cw-story',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './story.component.html',
  styleUrl: './story.component.scss',
})
export class StoryComponent {
  private readonly i18n = inject(I18nService);
  readonly t = (key: string): string => this.i18n.t(key);

  readonly heroImage =
    'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=1400&q=85&auto=format&fit=crop';

  readonly chapters: Chapter[] = [
    {
      year: '1962',
      titleKey: 'story.chapter.1962.title',
      bodyKey: 'story.chapter.1962.body',
      image: 'https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=900&q=85&auto=format&fit=crop',
      align: 'left',
    },
    {
      year: '1978',
      titleKey: 'story.chapter.1978.title',
      bodyKey: 'story.chapter.1978.body',
      image: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=900&q=85&auto=format&fit=crop',
      align: 'right',
    },
    {
      year: '1995',
      titleKey: 'story.chapter.1995.title',
      bodyKey: 'story.chapter.1995.body',
      image: 'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=900&q=85&auto=format&fit=crop',
      align: 'left',
    },
    {
      year: 'story.chapter.today.year',
      titleKey: 'story.chapter.today.title',
      bodyKey: 'story.chapter.today.body',
      image: 'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=900&q=85&auto=format&fit=crop',
      align: 'right',
    },
  ];

  readonly masters: Master[] = [
    { roleKey: 'story.role.leatherSelector', years: 30 },
    { roleKey: 'story.role.patternCutter', years: 22 },
    { roleKey: 'story.role.lastMaker', years: 18 },
    { roleKey: 'story.role.weltStitcher', years: 25 },
    { roleKey: 'story.role.heelBuilder', years: 15 },
    { roleKey: 'story.role.edgeFinisher', years: 28 },
  ];

  yearLabel(year: string): string {
    return year.startsWith('story.') ? this.t(year) : year;
  }

  onImgError(e: Event): void {
    (e.target as HTMLImageElement).style.display = 'none';
  }
}
