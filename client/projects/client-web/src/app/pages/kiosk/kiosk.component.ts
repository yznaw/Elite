import {
  Component, OnInit, OnDestroy, inject, signal, computed, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

type KioskStep = 'welcome' | 'product' | 'rating' | 'message' | 'contact' | 'thanks';

interface KioskProduct { id: string; name: string; image: string; }

interface ApiEnvelope<T> { success: boolean; data: T; }

@Component({
  selector: 'app-kiosk',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="k-shell" (click)="resetActivity()" (touchstart)="resetActivity()">

      <!-- ── Screen 1: Welcome ─────────────────────────────────── -->
      @if (step() === 'welcome') {
        <div class="kiosk k-welcome">
          <div class="k-welcome-bg"></div>
          <div class="k-logo">elite</div>
          <div class="k-logo-sub">Arabic Leather Artisans</div>
          <div class="k-diamond-line"><span class="k-diamond">◇</span></div>
          <div class="k-welcome-title">How was your experience<br/>with us today?</div>
          <div class="k-welcome-sub">Your feedback helps our artisans refine every detail.<br/>It takes less than a minute and is completely private.</div>
          <button class="k-start-btn" (click)="startFlow()">Share Your Feedback</button>
          <div class="k-privacy">◇ &nbsp; Your responses are private and used only by the Elite team</div>
        </div>
      }

      <!-- ── Screen 2: Product picker (when no product in URL) ── -->
      @if (step() === 'product') {
        <div class="kiosk k-product">
          <div class="k-step-header">
            <div class="k-step-logo">elite</div>
            <div class="k-step-progress">
              @for (_ of steps; track $index) {
                <div class="k-step-dot" [class.on]="$index === 0"></div>
              }
            </div>
            <button class="k-step-skip" type="button" (click)="skipProduct()">Skip →</button>
          </div>
          <div class="k-product-content">
            <div class="k-rate-eyebrow">Select a product</div>
            <div class="k-rate-title">Which item are you reviewing?</div>
            @if (loadingProducts()) {
              <div class="k-loading-dots"><span></span><span></span><span></span></div>
            } @else {
              <div class="k-product-grid">
                @for (p of products(); track p.id) {
                  <button class="k-product-card" type="button"
                          [class.on]="selectedProductId() === p.id"
                          (click)="selectProduct(p.id)">
                    @if (p.image) {
                      <img [src]="p.image" [alt]="p.name" class="k-product-img"/>
                    } @else {
                      <div class="k-product-placeholder">◈</div>
                    }
                    <div class="k-product-name">{{ p.name }}</div>
                  </button>
                }
              </div>
            }
            <div class="k-btns">
              <button class="k-btn-outline" type="button" (click)="skipProduct()">Skip</button>
              <button class="k-btn-gold" type="button"
                      [disabled]="!selectedProductId()"
                      (click)="goTo('rating')">Continue →</button>
            </div>
          </div>
        </div>
      }

      <!-- ── Screen 3: Rating ───────────────────────────────────── -->
      @if (step() === 'rating') {
        <div class="kiosk k-rating">
          <div class="k-step-header">
            <div class="k-step-logo">elite</div>
            <div class="k-step-progress">
              @for (_ of steps; track $index) {
                <div class="k-step-dot" [class.on]="$index <= ratingStepIdx()"></div>
              }
            </div>
            <button class="k-step-skip" type="button" (click)="goTo('message')">Skip →</button>
          </div>
          <div class="k-rating-content">
            <div class="k-rate-eyebrow">Step {{ ratingStepIdx() + 1 }} of {{ steps.length }}</div>
            <div class="k-rate-title">How would you rate<br/>your purchase?</div>
            <div class="k-big-stars">
              @for (n of [1,2,3,4,5]; track n) {
                <span class="k-big-star"
                      [class.on]="n <= (hoverRating() || rating())"
                      (mouseenter)="hoverRating.set(n)"
                      (mouseleave)="hoverRating.set(0)"
                      (click)="setRating(n)">★</span>
              }
            </div>
            <div class="k-rate-labels">
              <span class="k-rate-label">Poor</span>
              <span class="k-rate-label">Excellent</span>
            </div>
            <div class="k-rate-hint">Tap a star to rate</div>
            <button class="k-next-btn" type="button" (click)="goTo('message')">Continue →</button>
          </div>
        </div>
      }

      <!-- ── Screen 4: Message ──────────────────────────────────── -->
      @if (step() === 'message') {
        <div class="kiosk k-feedback">
          <div class="k-step-header">
            <div class="k-step-logo">elite</div>
            <div class="k-step-progress">
              @for (_ of steps; track $index) {
                <div class="k-step-dot" [class.on]="$index <= messageStepIdx()"></div>
              }
            </div>
            <button class="k-step-skip" type="button" (click)="goTo('contact')">Skip →</button>
          </div>
          <div class="k-feedback-content">
            <div class="k-feedback-title">Tell us more</div>
            <div class="k-feedback-sub">What did you love? What could be better?</div>
            <textarea class="k-textarea"
                      placeholder="Fit, leather quality, service, packaging — anything you'd like us to know…"
                      maxlength="600"
                      [(ngModel)]="messageText"
                      (ngModelChange)="message.set($event)"></textarea>
            <div class="k-char-count">{{ message().length }} / 600</div>
            <div class="k-btns">
              <button class="k-btn-outline" type="button" (click)="goTo('contact')">Skip</button>
              <button class="k-btn-gold" type="button" (click)="goTo('contact')">Continue →</button>
            </div>
          </div>
        </div>
      }

      <!-- ── Screen 5: Contact ──────────────────────────────────── -->
      @if (step() === 'contact') {
        <div class="kiosk k-contact">
          <div class="k-step-header">
            <div class="k-step-logo">elite</div>
            <div class="k-step-progress">
              @for (_ of steps; track $index) {
                <div class="k-step-dot on"></div>
              }
            </div>
            <button class="k-step-skip" type="button" (click)="submit()">Skip →</button>
          </div>
          <div class="k-contact-content">
            <div class="k-contact-title">May we reach out?</div>
            <div class="k-contact-sub">Completely optional. We may contact you to follow up on your feedback<br/>or share an exclusive offer as a thank-you.</div>
            <div class="k-contact-grid">
              <div class="k-contact-field">
                <div class="k-contact-label">Name</div>
                <input class="k-contact-input" placeholder="Your name" type="text"
                       [(ngModel)]="contactNameText" (ngModelChange)="contactName.set($event)"/>
              </div>
              <div class="k-contact-field">
                <div class="k-contact-label">Mobile Number</div>
                <input class="k-contact-input" placeholder="+974 XXXX XXXX" type="tel"
                       [(ngModel)]="contactPhoneText" (ngModelChange)="contactPhone.set($event)"/>
              </div>
              <div class="k-contact-field k-contact-full">
                <div class="k-contact-label">Email</div>
                <input class="k-contact-input" placeholder="your@email.com" type="email"
                       [(ngModel)]="contactEmailText" (ngModelChange)="contactEmail.set($event)"/>
              </div>
            </div>
            <div class="k-skip-note">◇ &nbsp;Your details are private and never shared with third parties</div>
            <div class="k-btns">
              <button class="k-btn-outline" type="button" (click)="submit()" [disabled]="submitting()">Skip</button>
              <button class="k-btn-gold" type="button" (click)="submit()" [disabled]="submitting()">
                {{ submitting() ? 'Submitting…' : 'Submit Feedback →' }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- ── Screen 6: Thank you ────────────────────────────────── -->
      @if (step() === 'thanks') {
        <div class="kiosk k-thanks">
          <div class="k-thanks-bg"></div>
          <div class="k-thanks-icon">✓</div>
          <div class="k-thanks-title">Thank you</div>
          <div class="k-thanks-sub">Your feedback has been recorded. Our artisans and team read every response personally — it helps us refine every detail of our craft.</div>
          <button class="k-thanks-restart" type="button" (click)="restart()">
            New Response &nbsp;↺
          </button>
          <div class="k-thanks-countdown">Returning to start in {{ countdown() }}s…</div>
        </div>
      }

    </div>
  `,
  styles: [`
    :host { display: block; width: 100vw; height: 100vh; overflow: hidden; }

    /* ── Shell ────────────────────────────── */
    .k-shell {
      width: 100%; height: 100%;
      font-family: 'Montserrat', sans-serif;
      position: relative;
    }

    .kiosk {
      position: absolute; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      overflow: hidden;
    }

    /* ── Welcome ──────────────────────────── */
    .k-welcome {
      background: #024638;
      text-align: center;
      padding: clamp(24px,5%,80px);
    }
    .k-welcome-bg {
      position: absolute; inset: 0;
      background: radial-gradient(ellipse at 50% 30%, rgba(184,146,74,.18), transparent 60%);
      pointer-events: none;
    }
    .k-logo {
      font-family: 'Cormorant Garamond', 'Georgia', serif;
      font-size: clamp(28px,4vw,52px); font-style: italic;
      color: #d4a853; position: relative; z-index: 1; margin-bottom: 4px;
    }
    .k-logo-sub {
      font-size: clamp(8px,1vw,11px); font-weight: 700;
      letter-spacing: .22em; text-transform: uppercase;
      color: rgba(184,146,74,.5); position: relative; z-index: 1; margin-bottom: 12px;
    }
    .k-diamond-line { position: relative; z-index: 1; margin-bottom: 14px; }
    .k-diamond { color: rgba(184,146,74,.45); font-size: 18px; }
    .k-welcome-title {
      font-size: clamp(18px,3vw,40px); font-weight: 300; color: #fff;
      line-height: 1.3; margin-bottom: 10px; position: relative; z-index: 1;
    }
    .k-welcome-sub {
      font-size: clamp(10px,1.3vw,16px); color: rgba(255,255,255,.45);
      line-height: 1.65; margin-bottom: clamp(20px,4%,44px);
      position: relative; z-index: 1; max-width: 560px;
    }
    .k-start-btn {
      padding: clamp(12px,1.8%,20px) clamp(32px,5%,72px);
      background: linear-gradient(135deg,#c9a96e,#9a7535);
      border: none; border-radius: 4px;
      color: #0d0b08; font-size: clamp(10px,1.3vw,14px);
      font-weight: 700; letter-spacing: .18em; text-transform: uppercase;
      cursor: pointer; font-family: inherit;
      box-shadow: 0 8px 28px rgba(184,146,74,.35);
      position: relative; z-index: 1; margin-bottom: clamp(16px,3%,32px);
      transition: transform .14s, box-shadow .14s;
    }
    .k-start-btn:hover { transform: translateY(-2px); box-shadow: 0 12px 36px rgba(184,146,74,.45); }
    .k-privacy {
      font-size: clamp(8px,.9vw,11px); color: rgba(255,255,255,.2);
      position: relative; z-index: 1;
    }

    /* ── Step header ──────────────────────── */
    .k-step-header {
      position: absolute; top: 0; left: 0; right: 0;
      background: #024638; padding: clamp(10px,1.8%,16px) clamp(16px,2.5%,36px);
      display: flex; align-items: center; justify-content: space-between;
      z-index: 10;
    }
    .k-step-logo {
      font-family: 'Cormorant Garamond','Georgia',serif;
      font-size: clamp(16px,2vw,24px); font-style: italic; color: #d4a853;
    }
    .k-step-progress { display: flex; gap: 6px; }
    .k-step-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: rgba(255,255,255,.2); transition: background .2s;
    }
    .k-step-dot.on { background: #d4a853; }
    .k-step-skip {
      font-size: clamp(9px,1vw,12px); font-weight: 600;
      color: rgba(255,255,255,.35); background: none; border: none;
      cursor: pointer; font-family: inherit; transition: color .14s;
    }
    .k-step-skip:hover { color: rgba(255,255,255,.7); }

    /* ── Product picker ───────────────────── */
    .k-product { background: #eee9df; }
    .k-product-content {
      text-align: center;
      padding: clamp(60px,10%,110px) clamp(20px,5%,80px) clamp(20px,4%,60px);
      width: 100%; max-width: 900px; overflow-y: auto; max-height: 100vh;
    }
    .k-product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(clamp(120px,18vw,180px), 1fr));
      gap: clamp(10px,2%,20px);
      margin: clamp(16px,3%,32px) 0;
    }
    .k-product-card {
      border: 2px solid rgba(0,0,0,.1); border-radius: 10px;
      background: rgba(255,255,255,.6); padding: clamp(10px,1.5%,18px);
      cursor: pointer; font-family: inherit; transition: all .15s;
      display: flex; flex-direction: column; align-items: center; gap: 10px;
    }
    .k-product-card.on { border-color: #b8924a; background: #fff; box-shadow: 0 0 0 3px rgba(184,146,74,.15); }
    .k-product-card:hover { border-color: #b8924a; }
    .k-product-img {
      width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px;
    }
    .k-product-placeholder {
      width: 100%; aspect-ratio: 1; display: flex; align-items: center;
      justify-content: center; font-size: 32px; color: #b8924a;
      background: rgba(184,146,74,.06); border-radius: 6px;
    }
    .k-product-name {
      font-size: clamp(10px,1.2vw,13px); font-weight: 600; color: #1a1208;
      text-align: center; line-height: 1.3;
    }

    /* ── Rating ───────────────────────────── */
    .k-rating { background: #eee9df; }
    .k-rating-content {
      text-align: center;
      padding: clamp(60px,10%,110px) clamp(20px,5%,80px) clamp(20px,4%,60px);
    }
    .k-rate-eyebrow {
      font-size: clamp(8px,1vw,11px); font-weight: 700; letter-spacing: .2em;
      text-transform: uppercase; color: #b8924a; margin-bottom: 10px;
    }
    .k-rate-title {
      font-size: clamp(20px,3vw,36px); font-weight: 600; color: #1a1208;
      line-height: 1.3; margin-bottom: clamp(20px,4%,44px);
    }
    .k-big-stars {
      display: flex; gap: clamp(8px,2vw,24px); justify-content: center;
      margin-bottom: clamp(10px,2%,20px);
    }
    .k-big-star {
      font-size: clamp(36px,7vw,72px); color: #ddd0bb;
      cursor: pointer; user-select: none; transition: color .1s, transform .1s;
    }
    .k-big-star.on { color: #b8924a; }
    .k-big-star:hover { transform: scale(1.1); }
    .k-rate-labels {
      display: flex; justify-content: space-between;
      width: clamp(180px,40vw,360px); margin: 0 auto clamp(10px,2%,20px);
    }
    .k-rate-label {
      font-size: clamp(8px,1vw,11px); font-weight: 700;
      letter-spacing: .12em; text-transform: uppercase; color: #8a7a62;
    }
    .k-rate-hint {
      font-size: clamp(9px,1.1vw,13px); color: #b8924a;
      margin-bottom: clamp(16px,3%,36px); font-style: italic;
    }
    .k-next-btn {
      padding: clamp(12px,1.8%,18px) clamp(40px,7%,88px);
      background: linear-gradient(135deg,#c9a96e,#9a7535);
      border: none; border-radius: 4px; color: #0d0b08;
      font-size: clamp(9px,1.1vw,13px); font-weight: 700;
      letter-spacing: .16em; text-transform: uppercase;
      cursor: pointer; font-family: inherit; transition: transform .14s;
    }
    .k-next-btn:hover { transform: translateY(-1px); }

    /* ── Message ──────────────────────────── */
    .k-feedback { background: #eee9df; }
    .k-feedback-content {
      text-align: center;
      padding: clamp(60px,10%,110px) clamp(20px,5%,80px) clamp(20px,4%,60px);
      width: 100%; max-width: 720px;
    }
    .k-feedback-title {
      font-size: clamp(20px,2.8vw,34px); font-weight: 700; color: #1a1208; margin-bottom: 6px;
    }
    .k-feedback-sub {
      font-size: clamp(11px,1.3vw,15px); color: #8a7a62;
      margin-bottom: clamp(20px,3%,36px);
    }
    .k-textarea {
      width: 100%; height: clamp(100px,15vh,200px);
      padding: clamp(14px,2%,22px); border: 1.5px solid rgba(0,0,0,.1);
      border-radius: 6px; font-size: clamp(13px,1.6vw,18px);
      font-family: inherit; resize: none;
      background: rgba(255,255,255,.7); color: #1a1208;
      transition: border-color .2s; margin-bottom: 8px;
    }
    .k-textarea:focus { outline: none; border-color: #b8924a; background: #fff; }
    .k-char-count {
      text-align: right; font-size: clamp(9px,1vw,12px); color: #8a7a62;
      margin-bottom: clamp(16px,3%,32px);
    }

    /* ── Contact ──────────────────────────── */
    .k-contact { background: #eee9df; }
    .k-contact-content {
      text-align: center;
      padding: clamp(60px,10%,110px) clamp(20px,5%,80px) clamp(20px,4%,60px);
      width: 100%; max-width: 700px;
    }
    .k-contact-title {
      font-size: clamp(20px,2.8vw,34px); font-weight: 700; color: #1a1208; margin-bottom: 6px;
    }
    .k-contact-sub {
      font-size: clamp(10px,1.2vw,14px); color: #8a7a62; line-height: 1.6;
      margin-bottom: clamp(20px,3%,36px);
    }
    .k-contact-grid {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: clamp(10px,1.5vw,18px); margin-bottom: clamp(12px,2%,20px);
      text-align: left;
    }
    @media (max-width: 600px) { .k-contact-grid { grid-template-columns: 1fr; } }
    .k-contact-full { grid-column: 1 / -1; }
    .k-contact-field { display: flex; flex-direction: column; gap: 7px; }
    .k-contact-label {
      font-size: clamp(8px,1vw,11px); font-weight: 700;
      letter-spacing: .14em; text-transform: uppercase; color: #8a7a62;
    }
    .k-contact-input {
      padding: clamp(12px,1.8%,18px) clamp(14px,2%,20px);
      border: 1.5px solid rgba(0,0,0,.1); border-radius: 5px;
      font-size: clamp(13px,1.6vw,18px); font-family: inherit;
      background: rgba(255,255,255,.7); color: #1a1208;
      transition: border-color .2s;
    }
    .k-contact-input:focus { outline: none; border-color: #b8924a; background: #fff; box-shadow: 0 0 0 4px rgba(184,146,74,.1); }
    .k-skip-note {
      font-size: clamp(9px,1vw,12px); color: rgba(26,18,8,.4);
      margin-bottom: clamp(16px,3%,32px);
    }

    /* ── Shared buttons ───────────────────── */
    .k-btns { display: flex; gap: clamp(10px,1.5%,16px); justify-content: center; }
    .k-btn-outline {
      padding: clamp(11px,1.6%,17px) clamp(24px,4%,56px);
      background: transparent; border: 1.5px solid rgba(0,0,0,.12);
      border-radius: 4px; color: #8a7a62;
      font-size: clamp(9px,1.1vw,13px); font-weight: 700;
      letter-spacing: .14em; text-transform: uppercase;
      cursor: pointer; font-family: inherit; transition: all .14s;
    }
    .k-btn-outline:hover { border-color: #b8924a; color: #b8924a; }
    .k-btn-gold {
      padding: clamp(11px,1.6%,17px) clamp(28px,5%,64px);
      background: linear-gradient(135deg,#c9a96e,#9a7535);
      border: none; border-radius: 4px; color: #0d0b08;
      font-size: clamp(9px,1.1vw,13px); font-weight: 700;
      letter-spacing: .15em; text-transform: uppercase;
      cursor: pointer; font-family: inherit; transition: transform .14s;
    }
    .k-btn-gold:hover:not(:disabled) { transform: translateY(-1px); }
    .k-btn-gold:disabled { opacity: .5; cursor: not-allowed; }

    /* ── Thank you ────────────────────────── */
    .k-thanks {
      background: #024638; text-align: center;
      padding: clamp(24px,5%,80px);
    }
    .k-thanks-bg {
      position: absolute; inset: 0;
      background: radial-gradient(ellipse at 50% 40%, rgba(184,146,74,.18), transparent 60%);
      pointer-events: none;
    }
    .k-thanks-icon {
      width: clamp(56px,8vw,88px); height: clamp(56px,8vw,88px);
      border-radius: 50%;
      background: linear-gradient(135deg,#c9a96e,#9a7535);
      display: flex; align-items: center; justify-content: center;
      font-size: clamp(22px,3.5vw,40px); color: #fff;
      margin-bottom: clamp(16px,3%,32px);
      position: relative; z-index: 1;
      box-shadow: 0 10px 32px rgba(184,146,74,.45);
    }
    .k-thanks-title {
      font-size: clamp(24px,4vw,52px); font-weight: 700; color: #fff;
      margin-bottom: 12px; position: relative; z-index: 1;
    }
    .k-thanks-sub {
      font-size: clamp(11px,1.4vw,17px); color: rgba(255,255,255,.5);
      line-height: 1.65; max-width: 500px; margin-bottom: clamp(20px,4%,48px);
      position: relative; z-index: 1;
    }
    .k-thanks-restart {
      padding: clamp(11px,1.6%,16px) clamp(24px,4%,52px);
      background: rgba(255,255,255,.1); border: 1.5px solid rgba(255,255,255,.2);
      border-radius: 4px; color: rgba(255,255,255,.7);
      font-size: clamp(9px,1.1vw,12px); font-weight: 700; letter-spacing: .16em;
      text-transform: uppercase; cursor: pointer; font-family: inherit;
      position: relative; z-index: 1; margin-bottom: clamp(12px,2%,24px);
      transition: all .15s;
    }
    .k-thanks-restart:hover { background: rgba(255,255,255,.18); color: #fff; }
    .k-thanks-countdown {
      font-size: clamp(9px,1vw,12px); color: rgba(255,255,255,.22);
      position: relative; z-index: 1;
    }

    /* ── Loading dots ─────────────────────── */
    .k-loading-dots {
      display: flex; gap: 8px; justify-content: center; margin: 32px 0;
    }
    .k-loading-dots span {
      width: 10px; height: 10px; border-radius: 50%; background: #b8924a;
      animation: dot-pulse 1.4s ease-in-out infinite;
    }
    .k-loading-dots span:nth-child(2) { animation-delay: .2s; }
    .k-loading-dots span:nth-child(3) { animation-delay: .4s; }
    @keyframes dot-pulse { 0%,80%,100%{opacity:.2;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }
  `],
})
export class KioskComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly http  = inject(HttpClient);

  // ── State ──────────────────────────────────────────────────
  readonly step             = signal<KioskStep>('welcome');
  readonly products         = signal<KioskProduct[]>([]);
  readonly loadingProducts  = signal(false);
  readonly selectedProductId = signal<string | null>(null);
  readonly rating           = signal(0);
  readonly hoverRating      = signal(0);
  readonly message          = signal('');
  readonly contactName      = signal('');
  readonly contactPhone     = signal('');
  readonly contactEmail     = signal('');
  readonly submitting       = signal(false);
  readonly countdown        = signal(10);

  // Two-way bound model strings (ngModel bridge for signals)
  messageText      = '';
  contactNameText  = '';
  contactPhoneText = '';
  contactEmailText = '';

  // Steps for progress dots (3 = no product picker, 4 = with picker)
  steps: number[] = [];

  private preselectedProductId: string | null = null;
  private activityTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  private readonly apiBase = (() => {
    const isLocal = typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    return isLocal
      ? `${window.location.protocol}//${window.location.hostname}:3000/api`
      : '/api';
  })();

  async ngOnInit(): Promise<void> {
    this.preselectedProductId = this.route.snapshot.queryParamMap.get('product');
    if (this.preselectedProductId) {
      this.selectedProductId.set(this.preselectedProductId);
      this.steps = [0, 1, 2]; // 3 steps: rating, message, contact
    } else {
      this.steps = [0, 1, 2, 3]; // 4 steps: product, rating, message, contact
      this.loadingProducts.set(true);
      try {
        const res = await firstValueFrom(
          this.http.get<ApiEnvelope<{ items: KioskProduct[] }>>(`${this.apiBase}/products?limit=20`),
        );
        this.products.set(res.data?.items ?? []);
      } catch {
        // If products fail to load, allow skipping
      } finally {
        this.loadingProducts.set(false);
      }
    }
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  // ── Step index helpers (for progress dots) ─────────────────
  ratingStepIdx(): number {
    return this.preselectedProductId ? 0 : 1;
  }
  messageStepIdx(): number {
    return this.preselectedProductId ? 1 : 2;
  }

  // ── Navigation ─────────────────────────────────────────────
  startFlow(): void {
    if (this.preselectedProductId) {
      this.step.set('rating');
    } else {
      this.step.set(this.products().length > 0 ? 'product' : 'rating');
    }
    this.startActivity();
  }

  goTo(next: KioskStep): void {
    this.step.set(next);
    this.resetActivity();
  }

  selectProduct(id: string): void {
    this.selectedProductId.set(id);
  }

  skipProduct(): void {
    this.selectedProductId.set(null);
    this.goTo('rating');
  }

  setRating(n: number): void {
    this.rating.set(n);
  }

  // ── Submit ─────────────────────────────────────────────────
  async submit(): Promise<void> {
    if (this.submitting()) return;
    const pid = this.selectedProductId();
    if (!pid) { this.goTo('thanks'); return; }

    this.submitting.set(true);
    try {
      await firstValueFrom(
        this.http.post(`${this.apiBase}/products/${pid}/reviews`, {
          rating:      this.rating() || null,
          body:        this.message().trim() || 'No message provided.',
          authorName:  this.contactName().trim() || null,
          authorPhone: this.contactPhone().trim() || null,
          authorEmail: this.contactEmail().trim() || null,
          source:      'kiosk',
        }),
      );
    } catch { /* silent — still show thanks */ } finally {
      this.submitting.set(false);
      this.goTo('thanks');
      this.startCountdown();
    }
  }

  // ── Restart ────────────────────────────────────────────────
  restart(): void {
    this.clearTimers();
    this.rating.set(0);
    this.hoverRating.set(0);
    this.message.set(''); this.messageText = '';
    this.contactName.set('');  this.contactNameText = '';
    this.contactPhone.set(''); this.contactPhoneText = '';
    this.contactEmail.set(''); this.contactEmailText = '';
    this.selectedProductId.set(this.preselectedProductId);
    this.countdown.set(10);
    this.step.set('welcome');
  }

  // ── Activity / auto-reset ──────────────────────────────────
  @HostListener('document:touchstart')
  @HostListener('document:click')
  resetActivity(): void {
    if (this.step() !== 'welcome' && this.step() !== 'thanks') {
      this.startActivity();
    }
  }

  private startActivity(): void {
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.activityTimer = setTimeout(() => this.restart(), 60_000);
  }

  private startCountdown(): void {
    this.countdown.set(10);
    this.countdownInterval = setInterval(() => {
      const v = this.countdown() - 1;
      this.countdown.set(v);
      if (v <= 0) { this.restart(); }
    }, 1000);
  }

  private clearTimers(): void {
    if (this.activityTimer) clearTimeout(this.activityTimer);
    if (this.countdownInterval) clearInterval(this.countdownInterval);
  }
}
