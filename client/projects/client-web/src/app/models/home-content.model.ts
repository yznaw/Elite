export interface HomeDiscountHeroContent {
  imageUrl: string;
  title: string;
  body: string;
  discountText: string;
  ctaText: string;
  ctaLink: string;
}

export interface HomeCollectionTileContent {
  id: string;
  title: string;
  imageUrl: string;
  link: string;
  ctaText?: string;
}

export interface HomeContentData {
  hero: HomeDiscountHeroContent;
  collections: HomeCollectionTileContent[];
}

export const DEFAULT_HOME_CONTENT: HomeContentData = {
  hero: {
    imageUrl: 'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=1500&q=85&auto=format&fit=crop',
    title: "Find Your Perfect Look at Elite's New Collection",
    body: 'Step into a sharper wardrobe with curated footwear, outerwear, and everyday essentials selected for modern city style.',
    discountText: '50%',
    ctaText: 'Shop Now',
    ctaLink: '/collection',
  },
  collections: [
    {
      id: 'footwear',
      title: 'Footwear',
      imageUrl: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=footwear',
    },
    {
      id: 'headwear',
      title: 'Headwear',
      imageUrl: 'https://images.unsplash.com/photo-1521369909029-2afed882baee?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=headwear',
      ctaText: 'Discover',
    },
    {
      id: 'jacket',
      title: 'Jacket',
      imageUrl: 'https://images.unsplash.com/photo-1520975682031-ae4edb553dcc?w=900&q=85&auto=format&fit=crop',
      link: '/collection?category=jacket',
    },
  ],
};
