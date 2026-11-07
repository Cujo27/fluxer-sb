// SPDX-License-Identifier: AGPL-3.0-or-later

import {makePersistent} from '@app/features/platform/utils/MobXPersistence';
import {initializeStore} from '@app/features/platform/utils/StoreInitialization';
import {makeAutoObservable} from 'mobx';

class SoundboardPreferences {
	volume = 100;
	favorites: Array<string> = [];
	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
		initializeStore(this, () => makePersistent(this, 'SoundboardPreferences', ['volume', 'favorites']));
	}
	setVolume(value: number): void {
		this.volume = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 100;
	}
	isFavorite(id: string): boolean {
		return this.favorites.includes(id);
	}
	toggleFavorite(id: string): void {
		this.favorites = this.isFavorite(id) ? this.favorites.filter((value) => value !== id) : [...this.favorites, id];
	}
}

export default new SoundboardPreferences();
