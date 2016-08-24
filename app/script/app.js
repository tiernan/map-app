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
"use strict";
// Namespace MapApp
var MapApp;
(function (MapApp) {
    // Time (ms) to bounce markers after search.
    var BOUNCE_TIME = 750;
    // Time (ms) to delay dropping new markers on map.
    var DELAY_TIME = 50;
    // Enum of states
    var States;
    (function (States) {
        States[States["FRESH"] = 0] = "FRESH";
        States[States["LOADING"] = 1] = "LOADING";
        States[States["LOADED"] = 2] = "LOADED";
        States[States["ERROR"] = 3] = "ERROR";
    })(States || (States = {}));
    // Keep data from loader.js, or init
    MapApp.librariesLoaded = MapApp.librariesLoaded || {};
    // object references
    var largeInfoWindow; // infowindow ref
    var user; // user model ref
    var main; // main vm ref
    var map; // map ref
    var database; // database ref
    // Panels/Overlays
    var activePanel = null;
    var userPopup = document.getElementById('panel-user');
    var controls = document.getElementById('controls');
    var overlayPane = document.getElementById('overlay');
    // Model to hold FourSquare info
    var FourSquareInfo = (function () {
        // construct using Four Square ID
        function FourSquareInfo(fourSquareID) {
            var self = this;
            this.id = fourSquareID;
            // pre load cached data
            var locationInfo = JSON.parse(window.localStorage.getItem(fourSquareID));
            if (!locationInfo) {
                locationInfo = {
                    photo: '',
                    tip: ''
                };
                this.state = ko.observable(States.FRESH);
            }
            else {
                this.state = ko.observable(States.LOADED);
            }
            if (!locationInfo.photo) {
                locationInfo.photo = '';
            }
            if (!locationInfo.tip) {
                locationInfo.tip = '';
            }
            this.loaded = ko.pureComputed(function () {
                return self.state() === States.LOADED;
            });
            this.error = ko.pureComputed(function () {
                return self.state() === States.ERROR;
            });
            this.update(locationInfo);
        }
        // load information asynchronously from FourSquare
        FourSquareInfo.prototype.load = function () {
            var self = this;
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
                    this.promise = new Promise(function (resolve, reject) {
                        self.state(States.LOADING);
                        loadJSON("https://api.foursquare.com/v2/venues/" + self.id
                            + "?client_id=M5DVPTFIAEL4YNMUSLFGGCWAAIQAS4QXEEVNN25PMX00PQJI"
                            + "&client_secret=3QCFHJAMN22HR3SSMHB5MQHRQ4YSIPV1U4AKZ1KYKSFQP42J"
                            + "&v=20160822")
                            .then(function (result) {
                            // TODO: handle API error
                            var response = JSON.parse(result);
                            var venue = response.response.venue;
                            var bestPhoto;
                            var topTip;
                            if (venue.bestPhoto) {
                                bestPhoto = venue.bestPhoto.prefix + '500x300' + venue.bestPhoto.suffix;
                            }
                            else {
                                bestPhoto = '';
                            }
                            if (venue.tips && venue.tips.count) {
                                topTip = venue.tips.groups[0].items[0].text;
                            }
                            else {
                                topTip = '';
                            }
                            var info = {
                                photo: bestPhoto,
                                tip: topTip
                            };
                            resolve(info);
                        }, function () {
                            reject();
                        });
                    });
                    this.promise.then(function (result) {
                        window.localStorage.setItem(self.id, JSON.stringify(result));
                        self.state(States.LOADED);
                        self.update(result);
                        self.promise = null;
                    }, function () {
                        self.state(States.ERROR);
                    });
                    return this.promise;
            }
        };
        // map object
        FourSquareInfo.prototype.update = function (data) {
            ko.mapping.fromJS(data, {}, this);
        };
        return FourSquareInfo;
    }());
    // Model for location
    var MapLocation = (function () {
        // construct from location data
        function MapLocation(locationData, selected) {
            var self = this;
            this.title = locationData.title;
            this.position = locationData.position;
            this.placeID = locationData.placeID;
            this.info = ko.observable(new FourSquareInfo(locationData.fourSquareID));
            this.marker = new google.maps.Marker({
                animation: google.maps.Animation.DROP,
                position: ko.toJS(locationData.position),
                title: locationData.title
            });
            this.marker.addListener('click', function () {
                main.changeLocation(self);
                self.populateInfoWindow();
            });
            this.comments = ko.observableArray([]);
            this.selected = ko.pureComputed(function () {
                return selected() === self;
            });
            // has ajax loading started?
            this.loading = ko.observable(false);
            this.visible = ko.observable(false);
        }
        // add comment to location
        MapLocation.prototype.comment = function (form) {
            database.ref('/tips/' + this.placeID + '/' + user.id()).set({
                content: form.comment.value,
                timestamp: Date.now()
            });
        };
        // show or hide from map
        MapLocation.prototype.setVisibility = function (visibility, animationDelay) {
            this.visible(visibility);
            if (visibility) {
                if (animationDelay) {
                    var marker_1 = this.marker;
                    setTimeout(function () {
                        marker_1.setMap(map);
                    }, animationDelay);
                }
                else {
                    this.marker.setMap(map);
                }
            }
            else {
                this.marker.setMap(null);
            }
        };
        // create infowindow popup
        MapLocation.prototype.populateInfoWindow = function () {
            var self = this;
            // Check to make sure the infowindow is not already opened on this marker.
            if (largeInfoWindow.marker !== this.marker) {
                if (largeInfoWindow.marker) {
                    largeInfoWindow.marker.setAnimation(null);
                }
                this.marker.setAnimation(google.maps.Animation.BOUNCE);
                largeInfoWindow.marker = this.marker;
                this.updateInfoWindow();
                var info = this.info();
                if (info.state() !== States.LOADED) {
                    info.load().then(function () {
                        self.updateInfoWindow();
                    }, function () {
                        self.updateInfoWindow();
                    });
                }
                largeInfoWindow.open(map, this.marker);
                // Make sure the marker property is cleared if the infowindow is closed.
                largeInfoWindow.addListener('closeclick', function () {
                    main.changeLocation(null);
                    largeInfoWindow.marker = null;
                });
            }
        };
        // update HTML inside of infowindow
        MapLocation.prototype.updateInfoWindow = function () {
            if (largeInfoWindow.marker === this.marker) {
                var html = '<div class="info-window"><div class="info-window-title">' + this.marker.title + '</div>';
                var info = this.info();
                if (info.state() === States.LOADED) {
                    if (info.photo()) {
                        html += '<div><img class="info-window-image" src="' + info.photo() + '"></div>';
                    }
                    if (info.tip()) {
                        html += '<div>' + info.tip() + '</div>';
                    }
                    html += '<div class="foursquare-credit">Data provided by FourSquare</div>';
                }
                else if (info.state() === States.ERROR) {
                    html += '<div class="foursquare-credit">More information unavailable at this time.</div>';
                }
                html += '</div>';
                largeInfoWindow.setContent(html);
            }
        };
        return MapLocation;
    }());
    // main view (list and map)
    var MainViewModel = (function () {
        // construct using user model (for comment form)
        function MainViewModel(userModel) {
            var self = this;
            this.locations = ko.observableArray([]);
            this.currentLocation = ko.observable(null);
            this.user = ko.observable(userModel);
            this.userCache = {};
            this.online = ko.observable(true);
            this.loaded = false;
            // load JSON data
            this.load();
            // function to change selected location
            this.changeLocation = function (location) {
                var previous = self.currentLocation();
                // disable bounce animation if previous location was selected and is not the same
                if (previous && previous !== location) {
                    previous.marker.setAnimation(null);
                    // stop watching firebase for previous location
                    database.ref('/tips/' + previous.placeID).off();
                }
                self.currentLocation(location);
                // start firebase monitoring back up on new location
                if (location) {
                    database.ref('/tips/' + location.placeID).on('value', function (snapshot) {
                        var commentArray = [];
                        var child;
                        var data = snapshot.val();
                        var _loop_1 = function() {
                            if (data.hasOwnProperty(child)) {
                                var otherUser_1;
                                if (self.userCache[child]) {
                                    otherUser_1 = self.userCache[child];
                                }
                                else {
                                    otherUser_1 = new PublicUserModel();
                                    database.ref('/users/' + child).once('value', function (userSnapshot) {
                                        otherUser_1.update(userSnapshot.val());
                                        self.userCache[child] = otherUser_1;
                                    });
                                }
                                commentArray.push({
                                    comment: data[child].content,
                                    timestamp: data[child].timestamp,
                                    user: ko.observable(otherUser_1)
                                });
                                location.comments(commentArray);
                            }
                        };
                        for (child in data) {
                            _loop_1();
                        }
                    });
                    // zoom map
                    map.setZoom(12);
                    // pan map
                    map.panTo(ko.toJS(location.position));
                }
            };
            // handle clicks from list
            this.listClick = function (location) {
                self.changeLocation(location);
                location.info().load();
                location.marker.setAnimation(google.maps.Animation.BOUNCE);
            };
        }
        // load JSON data
        MainViewModel.prototype.load = function () {
            var self = this;
            loadJSON('data/app.json')
                .then(function (jsonData) {
                self.loaded = true;
                ko.mapping.fromJS(JSON.parse(jsonData), {
                    "locations": {
                        create: function (options) {
                            return new MapLocation(options.data, self.currentLocation);
                        },
                        key: function (data) {
                            return ko.utils.unwrapObservable(data.placeID);
                        }
                    }
                }, self);
                ko.utils.arrayForEach(self.locations(), function (location, index) {
                    location.setVisibility(true, index * DELAY_TIME);
                });
            });
        };
        // filter location list using search string
        MainViewModel.prototype.filter = function (value) {
            value = value.toLowerCase();
            ko.utils.arrayForEach(this.locations(), function (location) {
                if (location.title.toLowerCase().indexOf(value) !== -1) {
                    location.setVisibility(true);
                    location.marker.setAnimation(google.maps.Animation.BOUNCE);
                    setTimeout(function () {
                        location.marker.setAnimation(null);
                    }, BOUNCE_TIME);
                }
                else {
                    location.setVisibility(false);
                }
            });
        };
        // reset location list when search input is empty
        MainViewModel.prototype.reset = function () {
            ko.utils.arrayForEach(this.locations(), function (location) {
                location.setVisibility(true);
                location.marker.setAnimation(google.maps.Animation.BOUNCE);
                setTimeout(function () {
                    location.marker.setAnimation(null);
                }, BOUNCE_TIME);
            });
        };
        return MainViewModel;
    }());
    // model for public users
    var PublicUserModel = (function () {
        function PublicUserModel(userData) {
            if (!userData) {
                userData = {
                    name: '',
                    photo: ''
                };
            }
            this.update(userData);
        }
        PublicUserModel.prototype.update = function (userData) {
            ko.mapping.fromJS(userData, {}, this);
        };
        return PublicUserModel;
    }());
    // model for current user
    var UserModel = (function () {
        function UserModel(userData) {
            var self = this;
            if (!userData) {
                userData = {
                    email: '',
                    id: '',
                    name: '',
                    photo: ''
                };
            }
            this.update(userData);
            this.loggedIn = ko.pureComputed(function () {
                return (self.id()) ? true : false;
            });
        }
        UserModel.prototype.update = function (userData) {
            ko.mapping.fromJS(userData, {}, this);
        };
        UserModel.prototype.clear = function () {
            this.name('');
            this.email('');
            this.photo('');
            this.id('');
        };
        return UserModel;
    }());
    // if new user, register their info in firebase
    function writeUserData(id, name, email, photo) {
        return database.ref('users/' + id).set({
            name: name,
            photo: photo
        }).then(function () {
            database.ref('usersPrivate/' + id).set({
                email: email
            });
        });
    }
    // start the app
    function init() {
        // create user model
        user = new UserModel();
        // bind user model
        ko.applyBindings(user, document.getElementById('header-user'));
        // Show user pane after 1s delay (prevent flashing);
        setTimeout(function () {
            document.getElementById('header-user-login').classList.remove('hidden');
        }, 1000);
        // create main view
        main = new MainViewModel(user);
        // bind main model
        ko.applyBindings(main, document.getElementById('controls'));
        // enable filtering
        document.getElementById('filter').addEventListener('keyup', function (event) {
            var inputEl = event.srcElement;
            var value = inputEl.value;
            if (value) {
                main.filter(value);
            }
            else {
                main.reset();
            }
        });
        // initialize Firebase
        firebase.initializeApp({
            apiKey: "AIzaSyCBVzGJFaKojZfr6U3sOUqbA0x33ZmzzWU",
            authDomain: "map-app-bc95b.firebaseapp.com",
            databaseURL: "https://map-app-bc95b.firebaseio.com",
            storageBucket: "map-app-bc95b.appspot.com"
        });
        // attach firebase DB to app
        database = firebase.database();
        // attach AuthStateChanged event listener to firebase
        firebase.auth().onAuthStateChanged(function (userInfo) {
            // if user is logged in
            if (userInfo) {
                database.ref('/users/' + userInfo.uid)
                    .once('value')
                    .then(function (snapshot) {
                    if (!snapshot || !snapshot.val()) {
                        return writeUserData(userInfo.uid, userInfo.displayName, userInfo.email, userInfo.photoURL);
                    }
                    else {
                        return Promise.resolve();
                    }
                }).then(function () {
                    database.ref('/users/' + userInfo.uid).on('value', function (snapshot) {
                        var data = snapshot.val();
                        ko.mapping.fromJS({
                            id: snapshot.key,
                            name: data.name,
                            photo: data.photo,
                        }, {}, user);
                    });
                    database.ref('/usersPrivate/' + userInfo.uid).on('value', function (snapshot) {
                        ko.mapping.fromJS({
                            email: snapshot.val().email
                        }, {}, user);
                    });
                });
            }
            else {
                var id = user.id();
                if (id) {
                    database.ref('/users/' + id).off();
                    database.ref('/usersPrivate/' + id).off();
                }
                user.clear();
            }
        });
        // monitor offline/online status
        database.ref(".info/connected").on("value", function (snapshot) {
            if (snapshot.val() === true) {
                main.online(true);
                if (main.loaded) {
                    if (main && main.currentLocation() && main.currentLocation().info().state() !== States.LOADED) {
                        if (largeInfoWindow.marker) {
                            var location_1 = main.currentLocation();
                            main.currentLocation().info().load().then(function () {
                                location_1.updateInfoWindow();
                            });
                        }
                        else {
                            main.currentLocation().info().load();
                        }
                    }
                }
                else {
                    // JSON data did not load previously, try again
                    main.load();
                }
            }
            else {
                main.online(false);
            }
        });
    }
    MapApp.init = init;
    // set overlay to dismiss active panel
    overlayPane.addEventListener('click', hideActive);
    function hideActive() {
        if (activePanel) {
            activePanel.classList.remove('active');
        }
        overlayPane.classList.remove('active');
    }
    // toggle user menu
    function toggleUserPanel() {
        activePanel = userPopup;
        userPopup.classList.toggle('active');
        overlayPane.classList.toggle('active');
    }
    MapApp.toggleUserPanel = toggleUserPanel;
    // toggle controls for small screens
    function toggleControls() {
        activePanel = controls;
        controls.classList.toggle('active');
        overlayPane.classList.toggle('active');
    }
    MapApp.toggleControls = toggleControls;
    //noinspection JSUnusedLocalSymbols
    // attempt to log the user in
    function logIn() {
        // Authenticate user with a Firebase Popup
        firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
    }
    MapApp.logIn = logIn;
    //noinspection JSUnusedLocalSymbols
    // load the user out
    function logOut() {
        toggleUserPanel();
        firebase.auth().signOut();
    }
    MapApp.logOut = logOut;
    //noinspection JSUnusedLocalSymbols
    // start rendering the map and init the app
    function initMap() {
        map = new google.maps.Map(document.getElementById('map'), {
            center: {
                lat: 37.803674,
                lng: -122.329186
            },
            styles: [
                {
                    featureType: 'water',
                    stylers: [
                        { color: '#80a0f0' }
                    ]
                }
            ],
            zoom: 10
        });
        largeInfoWindow = new google.maps.InfoWindow();
        // Polyfill IE
        if (isIE()) {
            loadScript('script/polyfill/ie-promise.js', init);
        }
        else {
            init();
        }
    }
    MapApp.initMap = initMap;
    //noinspection TsLint
    if (MapApp.librariesLoaded["GoogleMaps"]) {
        MapApp.initMap();
    }
})(MapApp || (MapApp = {}));
//# sourceMappingURL=app.js.map