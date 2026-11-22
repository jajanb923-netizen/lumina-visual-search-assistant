/** Curated sample photos shipped with the app (Unsplash, free licence). */
export interface SamplePhoto {
  id: string;
  src: string;
  title: string;
  hint: string;
}

export const SAMPLE_PHOTOS: SamplePhoto[] = [
  {
    id: "mountain",
    src: "/samples/mountain.jpg",
    title: "Mountain peak above the clouds",
    hint: "A snowy summit — try asking where the light comes from",
  },
  {
    id: "dog",
    src: "/samples/dog.jpg",
    title: "Dog mid-jump",
    hint: "A happy dog — ask what breed it looks like",
  },
  {
    id: "cat",
    src: "/samples/cat.jpg",
    title: "Cat close-up",
    hint: "A tabby cat — ask about its expression",
  },
  {
    id: "forest",
    src: "/samples/forest.jpg",
    title: "Foggy forest at dawn",
    hint: "Misty trees — ask what mood the scene has",
  },
  {
    id: "dinner",
    src: "/samples/dinner.jpg",
    title: "Dinner table",
    hint: "A shared meal — ask how many plates there are",
  },
  {
    id: "beach",
    src: "/samples/beach.jpg",
    title: "Tropical beach",
    hint: "Turquoise water — ask if anyone is swimming",
  },
];
