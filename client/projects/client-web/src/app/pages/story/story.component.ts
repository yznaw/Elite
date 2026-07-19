import { Component, OnInit, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HomeContentService } from '../../services/home-content.service';
import { LocaleService } from '../../services/locale.service';

@Component({
    selector: 'cw-story',
    imports: [CommonModule],
    templateUrl: './story.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrl: './story.component.scss'
})
export class StoryComponent implements OnInit {
  private readonly homeContent = inject(HomeContentService);
  readonly locale = inject(LocaleService);

  readonly content  = computed(() => this.homeContent.contentData().story);
  readonly chapters = computed(() => this.content().chapters);

  ngOnInit(): void {
    void this.homeContent.refresh(true);
  }

  onImgError(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }
}
