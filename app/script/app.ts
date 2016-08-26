/*!
 * Copyright (c) 2016, Tiernan Cridland
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby
 * granted, provided that the above copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER
 * IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 *
 * Sample Map Application
 * @author Tiernan Cridland
 * @email tiernanc@gmail.com
 * @license: ISC
 */
/// <reference path="../../custom_typings/firebase.ts" />
'use strict';

declare namespace google.maps {
	//noinspection JSUnusedLocalSymbols
	interface InfoWindow {
		marker: Marker;
	}
	interface Marker {
		title: string;
	}
}

// Namespace MapApp
namespace MapApp {
	import LatLng = google.maps.LatLng;
	import UserInfo = firebase.UserInfo;
	import Marker = google.maps.Marker;
	import InfoWindow = google.maps.InfoWindow;
	import DataSnapshot = firebase.database.DataSnapshot;

	// Time (ms) to bounce markers after search.
	const BOUNCE_TIME: number = 750;
	// Time (ms) to delay dropping new markers on map.
	const DELAY_TIME: number = 50;

	// Enum of states
	enum States {FRESH, LOADING, LOADED, ERROR}

	interface LibrariesList {
		[index: string]: boolean;
	}

	// Keep data from loader.js, or init
	export let librariesLoaded: LibrariesList = MapApp.librariesLoaded || {};

	// object references
	let largeInfoWindow: InfoWindow; // infowindow ref
	let user: UserModel; // user model ref
	let main: MainViewModel; // main vm ref
	let map: google.maps.Map; // map ref
	let database: firebase.database.Database; // database ref

	// Panels/Overlays
	let activePanel: HTMLElement = null;
	let userPopup: HTMLElement = document.getElementById('panel-user');
	let controls: HTMLElement = document.getElementById('controls');
	let overlayPane: HTMLElement = document.getElementById('overlay');

	interface LocationInfo {
		photo: string;
		tip: string;
	}

	interface UserDataPublic {
		id: string;
		name: string;
		photo: string;
	}

	interface MapLocationData {
		title: string;
		position: LatLng;
		placeID: string;
		fourSquareID: string;
	}

	interface CommentForm extends HTMLFormElement {
		comment: HTMLInputElement;
	}

	// Model to hold FourSquare info
	class FourSquareInfo {
		public error: KnockoutObservable<boolean>;
		public id: string;
		public loaded: KnockoutObservable<boolean>;
		public state: KnockoutObservable<States>;
		public photo: KnockoutObservable<string>;
		public promise: Promise<LocationInfo>;
		public tip: KnockoutObservable<string>;

		// construct using Four Square ID
		constructor(fourSquareID: string) {
			let self: FourSquareInfo = this;
			this.id = fourSquareID;
			// pre load cached data
			let locationInfo: LocationInfo = JSON.parse(window.localStorage.getItem(fourSquareID));

			if (!locationInfo) {
				locationInfo = {
					photo: '',
					tip: ''
				};
				this.state = ko.observable(States.FRESH);
			} else {
				this.state = ko.observable(States.LOADED);
			}
			if (!locationInfo.photo) {
				locationInfo.photo = '';
			}
			if (!locationInfo.tip) {
				locationInfo.tip = '';
			}

			this.loaded = ko.pureComputed(function (): boolean {
				return self.state() === States.LOADED;
			});

			this.error = ko.pureComputed(function (): boolean {
				return self.state() === States.ERROR;
			});

			this.update(locationInfo);
		}

		// load information asynchronously from FourSquare
		public load(): Promise<LocationInfo> {
			let self: FourSquareInfo = this;
			switch (this.state()) {
				// return current promise
				case States.LOADING:
					return this.promise;
				// return promise with current data
				case States.LOADED:
					return Promise.resolve({
						photo: this.photo(),
						tip: this.tip()
					});
				// Try or try again
				case States.ERROR:
				case States.FRESH:
				default:
					this.promise = new Promise(function (
						resolve: (info: LocationInfo) => Promise<LocationInfo>, reject: (reason?: any) => void
					): void {
						self.state(States.LOADING);
						loadJSON(
							'https://api.foursquare.com/v2/venues/' + self.id
							+ '?client_id=M5DVPTFIAEL4YNMUSLFGGCWAAIQAS4QXEEVNN25PMX00PQJI'
							+ '&client_secret=3QCFHJAMN22HR3SSMHB5MQHRQ4YSIPV1U4AKZ1KYKSFQP42J'
							+ '&v=20160822')
							.then(function (result: string): void {
								let response: any = JSON.parse(result);

								// reject if API responds with error
								if (response.error) {
									reject();
								}

								let venue: any = response.response.venue;
								let bestPhoto: string;
								let topTip: string;
								if (venue.bestPhoto) {
									bestPhoto = venue.bestPhoto.prefix + '500x300' + venue.bestPhoto.suffix;
								} else {
									bestPhoto = '';
								}

								if (venue.tips && venue.tips.count) {
									topTip = venue.tips.groups[0].items[0].text;
								} else {
									topTip = '';
								}
								let info: LocationInfo = {
									photo: bestPhoto,
									tip: topTip
								};

								resolve(info);
							}, function (): void {
								reject();
							});
					});
					this.promise.then(function (result: LocationInfo): void {
						window.localStorage.setItem(self.id, JSON.stringify(result));
						self.state(States.LOADED);
						self.update(result);
						self.promise = null;
					}, function (): void {
						self.state(States.ERROR);
					});
					return this.promise;
			}
		}

		// map object
		public update(data: any): void {
			ko.mapping.fromJS(data, {}, this);
		}
	}

	// Model for location
	class MapLocation {
		public comments: KnockoutObservableArray<any>; // user comments from FireBase
		public fourSquareID: string; // FourSquare ID (hardcoded to save on API calls)
		public info: KnockoutObservable<FourSquareInfo>; // info from FourSquare
		public loading: KnockoutObservable<boolean>;
		public marker: Marker;
		public placeID: string;
		public position: LatLng;
		public selected: KnockoutObservable<boolean>; // is location selected by user
		public title: string;
		public visible: KnockoutObservable<boolean>; // is location filtered or not

		// construct from location data
		constructor(locationData: MapLocationData, selected: KnockoutObservable<MapLocation>) {
			let self: MapLocation = this;
			this.title = locationData.title;
			this.position = locationData.position;
			this.placeID = locationData.placeID;
			this.info = ko.observable(new FourSquareInfo(locationData.fourSquareID));

			this.marker = new google.maps.Marker({
				animation: google.maps.Animation.DROP,
				position: ko.toJS(locationData.position),
				title: locationData.title
			});

			this.marker.addListener('click', function (): void {
				main.changeLocation(self);
				self.populateInfoWindow();
			});

			this.comments = ko.observableArray([]);

			this.selected = ko.pureComputed(function (): boolean {
				return selected() === self;
			});

			// has ajax loading started?
			this.loading = ko.observable(false);
			this.visible = ko.observable(false);
		}

		// add comment to location
		public comment(form: CommentForm): void {
			database.ref('/tips/' + this.placeID + '/' + user.id()).set({
				content: form.comment.value,
				timestamp: Date.now()
			});
		}

		// show or hide from map
		public setVisibility(visibility: boolean, animationDelay?: number): void {
			this.visible(visibility);
			if (visibility) {
				if (animationDelay) {
					let marker: google.maps.Marker = this.marker;
					setTimeout(function (): void {
						marker.setMap(map);
					}, animationDelay);
				} else {
					this.marker.setMap(map);
				}
			} else {
				this.marker.setMap(null);
			}
		}

		// create infowindow popup
		public populateInfoWindow(): void {
			let self: MapLocation = this;
			// Check to make sure the infowindow is not already opened on this marker.
			if (largeInfoWindow.marker !== this.marker) {
				if (largeInfoWindow.marker) {
					largeInfoWindow.marker.setAnimation(null);
				}
				this.marker.setAnimation(google.maps.Animation.BOUNCE);
				largeInfoWindow.marker = this.marker;
				this.updateInfoWindow();

				let info: FourSquareInfo = this.info();
				if (info.state() !== States.LOADED) {
					info.load().then(function (): void {
						self.updateInfoWindow();
					}, function (): void {
						self.updateInfoWindow();
					});
				}

				largeInfoWindow.open(map, this.marker);
				// Make sure the marker property is cleared if the infowindow is closed.
				largeInfoWindow.addListener('closeclick', function (): void {
					main.changeLocation(null);
					largeInfoWindow.marker = null;
				});
			}
		}

		// update HTML inside of infowindow
		public updateInfoWindow(): void {
			if (largeInfoWindow.marker === this.marker) {
				let html: string = '<div class="info-window"><div class="info-window-title">' + this.marker.title + '</div>';
				let info: FourSquareInfo = this.info();
				if (info.state() === States.LOADED) {
					if (info.photo()) {
						html += '<div><img class="info-window-image" src="' + info.photo() + '"></div>';
					}
					if (info.tip()) {
						html += '<div>' + info.tip() + '</div>';
					}
					html += '<div class="foursquare-credit">Data provided by FourSquare</div>';
				} else if (info.state() === States.ERROR) {
					html += '<div class="foursquare-credit">More information unavailable at this time.</div>';
				}
				html += '</div>';
				largeInfoWindow.setContent(html);
			}
		}
	}

	interface UserCache {
		[index: string]: any;
	}

	interface CommentData {
		comment: string;
		timestamp: number;
		user: KnockoutObservable<PublicUserModel>;
	}

	// main view (list and map)
	class MainViewModel {
		public changeLocation: (location: MapLocation, event?: Event) => void;
		public currentLocation: KnockoutObservable<MapLocation>;
		public listClick: (location: MapLocation, event?: Event) => void;
		public loaded: boolean;
		public locations: KnockoutObservableArray<MapLocation>;
		public online: KnockoutObservable<boolean>;
		public user: KnockoutObservable<UserModel>;
		public userCache: UserCache;

		// construct using user model (for comment form)
		constructor(userModel: UserModel) {
			let self: MainViewModel = this;
			this.locations = ko.observableArray([]);
			this.currentLocation = ko.observable(null);
			this.user = ko.observable(userModel);
			this.userCache = {};
			this.online = ko.observable(true);
			this.loaded = false;

			// load JSON data
			this.load();

			// function to change selected location
			this.changeLocation = function (location: MapLocation): void {
				let previous: MapLocation = self.currentLocation();
				// disable bounce animation if previous location was selected and is not the same
				if (previous && previous !== location) {
					previous.marker.setAnimation(null);
					// stop watching firebase for previous location
					database.ref('/tips/' + previous.placeID).off();
				}
				self.currentLocation(location);

				// start firebase monitoring back up on new location
				if (location) {
					database.ref('/tips/' + location.placeID).on('value', function (snapshot: DataSnapshot): void {
						let commentArray: Array<CommentData> = [];
						let child: string;
						let data: CommentData = snapshot.val();
						for (child in data) {
							if (data.hasOwnProperty(child)) {
								let otherUser: PublicUserModel;
								if (self.userCache[child]) {
									otherUser = self.userCache[child];
								} else {
									otherUser = new PublicUserModel();
									database.ref('/users/' + child).once('value',
										function (userSnapshot: DataSnapshot): void {
											otherUser.update(userSnapshot.val());
											self.userCache[child] = otherUser;
										});
								}
								commentArray.push({
									comment: data[child].content,
									timestamp: data[child].timestamp,
									user: ko.observable(otherUser)
								});
								location.comments(commentArray);
							}
						}
					});
					// zoom map
					map.setZoom(12);
					// pan map
					map.panTo(ko.toJS(location.position));
				}
			};

			// handle clicks from list
			this.listClick = function (location: MapLocation): void {
				self.changeLocation(location);
				location.info().load();
				location.marker.setAnimation(google.maps.Animation.BOUNCE);
			};
		}

		// load JSON data
		public load(): void {
			let self: MainViewModel = this;
			loadJSON('data/app.json')
				.then(function (jsonData: string): void {
					self.loaded = true;
					ko.mapping.fromJS(JSON.parse(jsonData), {
						locations: {
							create(options: KnockoutMappingCreateOptions): MapLocation {
								return new MapLocation(options.data, self.currentLocation);
							},
							key(data: MapLocation): string {
								return ko.utils.unwrapObservable(data.placeID);
							}
						}
					}, self);

					ko.utils.arrayForEach(self.locations(), function (location: MapLocation, index: number): void {
						location.setVisibility(true, index * DELAY_TIME);
					});
				});
		}

		// filter location list using search string
		public filter(value: string): void {
			value = value.toLowerCase();
			ko.utils.arrayForEach(this.locations(), function (location: MapLocation): void {
				if (location.title.toLowerCase().indexOf(value) !== -1) {
					location.setVisibility(true);
					location.marker.setAnimation(google.maps.Animation.BOUNCE);
					setTimeout(function (): void {
						location.marker.setAnimation(null);
					}, BOUNCE_TIME);
				} else {
					location.setVisibility(false);
				}
			});
		}

		// reset location list when search input is empty
		public reset(): void {
			ko.utils.arrayForEach(this.locations(), function (location: MapLocation): void {
				location.setVisibility(true);
				location.marker.setAnimation(google.maps.Animation.BOUNCE);
				setTimeout(function (): void {
					location.marker.setAnimation(null);
				}, BOUNCE_TIME);
			});
		}
	}

	interface UserData extends PublicUserData {
		email: string;
		id: string;
	}

	interface PublicUserData {
		name: string;
		photo: string;
	}

	// model for public users
	class PublicUserModel {
		public name: KnockoutObservable<string>;
		public photo: KnockoutObservable<string>;

		constructor(userData?: PublicUserData) {
			if (!userData) {
				userData = {
					name: '',
					photo: ''
				};
			}
			this.update(userData);
		}

		public update(userData: PublicUserData): void {
			ko.mapping.fromJS(userData, {}, this);
		}
	}

	// model for current user
	class UserModel {
		public name: KnockoutObservable<string>;
		public email: KnockoutObservable<string>;
		public photo: KnockoutObservable<string>;
		public id: KnockoutObservable<string>;
		public loggedIn: KnockoutObservable<boolean>;

		constructor(userData?: UserData) {
			let self: UserModel = this;

			if (!userData) {
				userData = {
					email: '',
					id: '',
					name: '',
					photo: ''
				};
			}

			this.update(userData);

			this.loggedIn = ko.pureComputed(function (): boolean {
				return (self.id()) ? true : false;
			});
		}

		public update(userData: UserData): void {
			ko.mapping.fromJS(userData, {}, this);
		}

		public clear(): void {
			this.name('');
			this.email('');
			this.photo('');
			this.id('');
		}
	}

	// if new user, register their info in firebase
	function writeUserData(id: string, name: string, email: string, photo: string): Promise<void> {
		return database.ref('users/' + id).set({
			name,
			photo
		}).then(function (): void {
			database.ref('usersPrivate/' + id).set({
				email
			});
		});
	}

	// start the app
	export function init(): void {
		// create user model
		user = new UserModel();

		// bind user model
		ko.applyBindings(user, document.getElementById('header-user'));

		// Show user pane after 1s delay (prevent flashing);
		setTimeout(function (): void {
			document.getElementById('header-user-login').classList.remove('hidden');
		}, 1000);

		// create main view
		main = new MainViewModel(user);

		// bind main model
		ko.applyBindings(main, document.getElementById('controls'));

		// enable filtering
		document.getElementById('filter').addEventListener('keyup', function (event: KeyboardEvent): void {
			let inputEl: HTMLInputElement = event.srcElement as HTMLInputElement;
			let value: string = inputEl.value;
			if (value) {
				main.filter(value);
			} else {
				main.reset();
			}
		});

		// initialize Firebase
		firebase.initializeApp({
			apiKey: 'AIzaSyCBVzGJFaKojZfr6U3sOUqbA0x33ZmzzWU',
			authDomain: 'map-app-bc95b.firebaseapp.com',
			databaseURL: 'https://map-app-bc95b.firebaseio.com',
			storageBucket: 'map-app-bc95b.appspot.com'
		});

		// attach firebase DB to app
		database = firebase.database();

		// attach AuthStateChanged event listener to firebase
		firebase.auth().onAuthStateChanged(function (userInfo: UserInfo): void {
			// if user is logged in
			if (userInfo) {
				database.ref('/users/' + userInfo.uid)
					.once('value')
					.then(function (snapshot: DataSnapshot): Promise<void> {
						if (!snapshot || !snapshot.val()) {
							return writeUserData(userInfo.uid, userInfo.displayName, userInfo.email, userInfo.photoURL);
						} else {
							return Promise.resolve();
						}
					}).then(function (): void {
						database.ref('/users/' + userInfo.uid).on('value', function (snapshot: DataSnapshot): void {
							let data: UserDataPublic = snapshot.val();
							ko.mapping.fromJS({
								id: snapshot.key,
								name: data.name,
								photo: data.photo,
							}, {}, user);
						});
						database.ref('/usersPrivate/' + userInfo.uid).on('value', function (snapshot: DataSnapshot): void {
							ko.mapping.fromJS({
								email: snapshot.val().email
							}, {}, user);
						});
					}
				);
				// if user is logged out
			} else {
				let id: string = user.id();
				if (id) {
					database.ref('/users/' + id).off();
					database.ref('/usersPrivate/' + id).off();
				}
				user.clear();
			}
		});

		// monitor offline/online status
		database.ref('.info/connected').on('value', function (snapshot: DataSnapshot): void {
			if (snapshot.val() === true) {
				main.online(true);
				if (main.loaded) {
					if (main && main.currentLocation() && main.currentLocation().info().state() !== States.LOADED) {
						if (largeInfoWindow.marker) {
							let location: MapLocation = main.currentLocation();
							main.currentLocation().info().load().then(function (): void {
								location.updateInfoWindow();
							});
						} else {
							main.currentLocation().info().load();
						}
					}
				} else {
					// JSON data did not load previously, try again
					main.load();
				}
			} else {
				main.online(false);
			}
		});
	}

	// set overlay to dismiss active panel
	overlayPane.addEventListener('click', hideActive);

	function hideActive(): void {
		if (activePanel) {
			activePanel.classList.remove('active');
		}
		overlayPane.classList.remove('active');
	}

	// toggle user menu
	export function toggleUserPanel(): void {
		activePanel = userPopup;
		userPopup.classList.toggle('active');
		overlayPane.classList.toggle('active');
	}

	// toggle controls for small screens
	//noinspection JSUnusedLocalSymbols
	export function toggleControls(): void {
		activePanel = controls;
		controls.classList.toggle('active');
		overlayPane.classList.toggle('active');
	}

	// attempt to log the user in
	//noinspection JSUnusedLocalSymbols
	export function logIn(): void {
		// Authenticate user with a Firebase Popup
		firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
	}

	// load the user out
	//noinspection JSUnusedLocalSymbols
	export function logOut(): void {
		toggleUserPanel();
		firebase.auth().signOut();
	}

	//noinspection JSUnusedLocalSymbols
	// start rendering the map and init the app
	export function initMap(): void {
		map = new google.maps.Map(document.getElementById('map'), {
			center: {
				lat: 37.803674,
				lng: -122.329186
			},
			styles: [
				{
					featureType: 'water',
					stylers: [
						{color: '#80a0f0'}
					]
				}
			],
			zoom: 10
		});

		largeInfoWindow = new google.maps.InfoWindow();

		// Polyfill IE
		if (isIE()) {
			loadScript('script/polyfill/ie-promise.js', init);
		} else {
			init();
		}
	}

	//noinspection TsLint
	if (MapApp.librariesLoaded["GoogleMaps"]) {
		MapApp.initMap();
	}
}