import { Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HomeContentService } from '../../services/home-content.service';

@Component({
  selector: 'cw-story',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './story.component.html',
  styleUrl: './story.component.scss',
})
export class StoryComponent implements OnInit {
  private readonly homeContent = inject(HomeContentService);

  readonly content = computed(() => this.homeContent.contentData().story);
  readonly chapters = computed(() => this.content().chapters);

  ngOnInit(): void {
    void this.homeContent.refresh(true);
  }

  onImgError(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }
}
