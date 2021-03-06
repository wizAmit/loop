/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global Frame:false uncaughtError:true */

(function() {
  "use strict";

  // Stop the default init functions running to avoid conflicts.
  document.removeEventListener("DOMContentLoaded", loop.panel.init);
  document.removeEventListener("DOMContentLoaded", loop.conversation.init);
  document.removeEventListener("DOMContentLoaded", loop.copy.init);

  var sharedActions = loop.shared.actions;

  // 1. Desktop components
  // 1.1 Panel
  var PanelView = loop.panel.PanelView;
  var SharePanelView = loop.panel.SharePanelView;
  var SignInRequestView = loop.panel.SignInRequestView;
  var RenameRoomView = loop.panel.RenameRoomView;
  // 1.2. Conversation Window
  var RoomFailureView = loop.roomViews.RoomFailureView;
  var DesktopRoomConversationView = loop.roomViews.DesktopRoomConversationView;
  // 1.3. Copy Panel
  var CopyView = loop.copy.CopyView;

  // 2. Standalone webapp
  var UnsupportedBrowserView = loop.webapp.UnsupportedBrowserView;
  var UnsupportedDeviceView = loop.webapp.UnsupportedDeviceView;
  var StandaloneRoomView = loop.standaloneRoomViews.StandaloneRoomView;
  var StandaloneHandleUserAgentView = loop.standaloneRoomViews.StandaloneHandleUserAgentView;

  // 3. Shared components
  var ConversationToolbar = loop.shared.views.ConversationToolbar;
  var FeedbackView = loop.feedbackViews.FeedbackView;
  var Checkbox = loop.shared.views.Checkbox;
  var TextChatView = loop.shared.views.chat.TextChatView;

  // Store constants
  var ROOM_STATES = loop.store.ROOM_STATES;
  var FAILURE_DETAILS = loop.shared.utils.FAILURE_DETAILS;

  function noop() {}

  // We save the visibility change listeners so that we can fake an event
  // to the panel once we've loaded all the views.
  var visibilityListeners = [];
  var rootObject = window;

  rootObject.document.addEventListener = function(eventName, func) {
    if (eventName === "visibilitychange") {
      visibilityListeners.push(func);
    }
    window.addEventListener(eventName, func);
  };

  rootObject.document.removeEventListener = function(eventName, func) {
    if (eventName === "visibilitychange") {
      var index = visibilityListeners.indexOf(func);
      visibilityListeners.splice(index, 1);
    }
    window.removeEventListener(eventName, func);
  };

  loop.shared.mixins.setRootObject(rootObject);

  var dispatcher = new loop.Dispatcher();

  var MockSDK = function() {
    dispatcher.register(this, [
      "setupStreamElements"
    ]);
  };

  MockSDK.prototype = {
    setupStreamElements: function() {
      // Dummy function to stop warnings.
    },

    sendTextChatMessage: function(actionData) {
      dispatcher.dispatch(new loop.shared.actions.ReceivedTextChatMessage({
        contentType: loop.shared.utils.CHAT_CONTENT_TYPES.TEXT,
        message: actionData.message,
        receivedTimestamp: actionData.sentTimestamp
      }));
    }
  };

  var mockSDK = new MockSDK();

  /**
   * Every view that uses an activeRoomStore needs its own; if they shared
   * an active store, they'd interfere with each other.
   *
   * @param options
   * @returns {loop.store.ActiveRoomStore}
   */
  function makeActiveRoomStore(options) {
    var roomDispatcher = new loop.Dispatcher();

    var store = new loop.store.ActiveRoomStore(roomDispatcher, {
      sdkDriver: mockSDK
    });

    if (!("remoteVideoEnabled" in options)) {
      options.remoteVideoEnabled = true;
    }

    if (!("mediaConnected" in options)) {
      options.mediaConnected = true;
    }

    store.setStoreState({
      mediaConnected: options.mediaConnected,
      remoteVideoEnabled: options.remoteVideoEnabled,
      roomName: "A Very Long Conversation Name",
      roomState: options.roomState,
      roomUrl: options.roomUrl,
      streamPaused: options.streamPaused,
      used: !!options.roomUsed,
      videoMuted: !!options.videoMuted
    });

    store.forcedUpdate = function forcedUpdate(contentWindow) {
      // Since this is called by setTimeout, we don't want to lose any
      // exceptions if there's a problem and we need to debug, so...
      try {
        // the dimensions here are taken from the poster images that we're
        // using, since they give the <video> elements their initial intrinsic
        // size.  This ensures that the right aspect ratios are calculated.
        // These are forced to 640x480, because it makes it visually easy to
        // validate that the showcase looks like the real app on a chine
        // (eg MacBook Pro) where that is the default camera resolution.
        var newStoreState = {
          localVideoDimensions: {
            camera: { height: 480, orientation: 0, width: 640 }
          },
          mediaConnected: options.mediaConnected,
          receivingScreenShare: !!options.receivingScreenShare,
          remoteVideoDimensions: {
            camera: { height: 480, orientation: 0, width: 640 }
          },
          remoteVideoEnabled: options.remoteVideoEnabled,
          // Override the matchMedia, this is so that the correct version is
          // used for the frame.
          //
          // Currently, we use an icky hack, and the showcase conspires with
          // react-frame-component to set iframe.contentWindow.matchMedia onto
          // the store. Once React context matures a bit (somewhere between
          // 0.14 and 1.0, apparently):
          //
          // https://facebook.github.io/react/blog/2015/02/24/
          // streamlining-react-elements.html#solution-make-context-parent-based-instead-of-owner-based
          //
          // we should be able to use those to clean this up.
          matchMedia: contentWindow.matchMedia.bind(contentWindow),
          roomState: options.roomState,
          videoMuted: !!options.videoMuted
        };

        if (options.receivingScreenShare) {
          // Note that the image we're using had to be scaled a bit, and
          // it still ended up a bit narrower than the live thing that
          // WebRTC sends; presumably a different scaling algorithm.
          // For showcase purposes, this shouldn't matter much, as the sizes
          // of things being shared will be fairly arbitrary.
          newStoreState.remoteVideoDimensions.screen =
          { height: 456, orientation: 0, width: 641 };
        }

        store.setStoreState(newStoreState);
      } catch (ex) {
        console.error("exception in forcedUpdate:", ex);
      }
    };

    return store;
  }

  var activeRoomStore = makeActiveRoomStore({
    roomState: ROOM_STATES.HAS_PARTICIPANTS
  });

  var joinedRoomStore = makeActiveRoomStore({
    mediaConnected: false,
    roomState: ROOM_STATES.JOINED,
    remoteVideoEnabled: false
  });

  var loadingRemoteVideoRoomStore = makeActiveRoomStore({
    mediaConnected: false,
    roomState: ROOM_STATES.HAS_PARTICIPANTS,
    remoteSrcMediaElement: false
  });

  var readyRoomStore = makeActiveRoomStore({
    mediaConnected: false,
    roomState: ROOM_STATES.READY
  });

  var updatingActiveRoomStore = makeActiveRoomStore({
    roomState: ROOM_STATES.HAS_PARTICIPANTS
  });

  var updatingMobileActiveRoomStore = makeActiveRoomStore({
    roomState: ROOM_STATES.HAS_PARTICIPANTS
  });

  var localFaceMuteRoomStore = makeActiveRoomStore({
    roomState: ROOM_STATES.HAS_PARTICIPANTS,
    videoMuted: true
  });

  var remoteFaceMuteRoomStore = makeActiveRoomStore({
    roomState: ROOM_STATES.HAS_PARTICIPANTS,
    remoteVideoEnabled: false,
    mediaConnected: true
  });

  var updatingSharingRoomStore = makeActiveRoomStore({
    roomState: ROOM_STATES.HAS_PARTICIPANTS,
    receivingScreenShare: true
  });

  var updatingSharingRoomMobileStore = makeActiveRoomStore({
    roomState: ROOM_STATES.HAS_PARTICIPANTS,
    receivingScreenShare: true
  });

  var loadingRemoteLoadingScreenStore = makeActiveRoomStore({
    mediaConnected: false,
    receivingScreenShare: true,
    roomState: ROOM_STATES.HAS_PARTICIPANTS,
    remoteSrcMediaElement: false
  });
  var loadingScreenSharingRoomStore = makeActiveRoomStore({
    receivingScreenShare: true,
    roomState: ROOM_STATES.HAS_PARTICIPANTS
  });

  /* Set up the stores for pending screen sharing */
  loadingScreenSharingRoomStore.receivingScreenShare({
    receiving: true,
    srcMediaElement: false
  });
  loadingRemoteLoadingScreenStore.receivingScreenShare({
    receiving: true,
    srcMediaElement: false
  });

  var fullActiveRoomStore = makeActiveRoomStore({
    roomState: ROOM_STATES.FULL
  });

  var failedRoomStore = makeActiveRoomStore({
    roomState: ROOM_STATES.FAILED
  });

  var invitationRoomStore = new loop.store.RoomStore(dispatcher, {
    constants: {},
    activeRoomStore: makeActiveRoomStore({
      roomState: ROOM_STATES.INIT,
      roomUrl: "http://showcase"
    })
  });

  var roomStore = new loop.store.RoomStore(dispatcher, {
    constants: {},
    activeRoomStore: makeActiveRoomStore({
      roomState: ROOM_STATES.HAS_PARTICIPANTS
    }),
    IsMultiProcessEnabled: function() { return true; }
  });

  var desktopRoomStoreLoading = new loop.store.RoomStore(dispatcher, {
    constants: {},
    activeRoomStore: makeActiveRoomStore({
      roomState: ROOM_STATES.HAS_PARTICIPANTS,
      mediaConnected: false,
      remoteSrcMediaElement: false
    })
  });

  var desktopRoomStoreMedium = new loop.store.RoomStore(dispatcher, {
    constants: {},
    activeRoomStore: makeActiveRoomStore({
      roomState: ROOM_STATES.HAS_PARTICIPANTS
    })
  });

  var desktopRoomStoreLarge = new loop.store.RoomStore(dispatcher, {
    constants: {},
    activeRoomStore: makeActiveRoomStore({
      roomState: ROOM_STATES.HAS_PARTICIPANTS
    })
  });

  var desktopLocalFaceMuteActiveRoomStore = makeActiveRoomStore({
    roomState: ROOM_STATES.HAS_PARTICIPANTS,
    videoMuted: true
  });
  var desktopLocalFaceMuteRoomStore = new loop.store.RoomStore(dispatcher, {
    constants: {},
    activeRoomStore: desktopLocalFaceMuteActiveRoomStore
  });

  var desktopRemoteFaceMuteActiveRoomStore = makeActiveRoomStore({
    roomState: ROOM_STATES.HAS_PARTICIPANTS,
    remoteVideoEnabled: false,
    mediaConnected: true
  });
  var desktopRemoteFaceMuteRoomStore = new loop.store.RoomStore(dispatcher, {
    constants: {},
    activeRoomStore: desktopRemoteFaceMuteActiveRoomStore
  });

  var screenSharePausedActiveRoomStore = makeActiveRoomStore({
    roomState: ROOM_STATES.HAS_PARTICIPANTS,
    streamPaused: true
  });

  var sharePanelActiveRoomStore = makeActiveRoomStore({});
  sharePanelActiveRoomStore.setStoreState({
    activeRoom: {
      roomUrl: "http://wonderfuk.invalid"
    }
  });

  var textChatStore = new loop.store.TextChatStore(dispatcher, {
    sdkDriver: mockSDK
  });

  // Update the text chat store with the room info.
  textChatStore.updateRoomInfo(new sharedActions.UpdateRoomInfo({
    roomName: "A Very Long Conversation Name",
    roomUrl: "http://showcase",
    roomContextUrls: [{
      description: "A wonderful page!",
      location: "http://wonderful.invalid"
      // use the fallback thumbnail
    }]
  }));

  textChatStore.setStoreState({ textChatEnabled: true });

  dispatcher.dispatch(new sharedActions.SendTextChatMessage({
    contentType: loop.shared.utils.CHAT_CONTENT_TYPES.TEXT,
    message: "Rheet!",
    sentTimestamp: "2015-06-23T22:21:45.590Z"
  }));
  dispatcher.dispatch(new sharedActions.ReceivedTextChatMessage({
    contentType: loop.shared.utils.CHAT_CONTENT_TYPES.TEXT,
    message: "Hello",
    receivedTimestamp: "2015-06-23T23:24:45.590Z"
  }));
  dispatcher.dispatch(new sharedActions.SendTextChatMessage({
    contentType: loop.shared.utils.CHAT_CONTENT_TYPES.TEXT,
    message: "Nowforareallylongwordwithoutspacesorpunctuationwhichshouldcause" +
    "linewrappingissuesifthecssiswrong",
    sentTimestamp: "2015-06-23T22:23:45.590Z"
  }));
  dispatcher.dispatch(new sharedActions.SendTextChatMessage({
    contentType: loop.shared.utils.CHAT_CONTENT_TYPES.TEXT,
    message: "Check out this menu from DNA Pizza:" +
    " http://example.com/DNA/pizza/menu/lots-of-different-kinds-of-pizza/" +
    "%8D%E0%B8%88%E0%B8%A1%E0%B8%A3%E0%8D%E0%B8%88%E0%B8%A1%E0%B8%A3%E0%",
    sentTimestamp: "2015-06-23T22:23:45.590Z"
  }));
  dispatcher.dispatch(new sharedActions.ReceivedTextChatMessage({
    contentType: loop.shared.utils.CHAT_CONTENT_TYPES.TEXT,
    message: "That avocado monkey-brains pie sounds tasty!",
    receivedTimestamp: "2015-06-23T22:25:45.590Z"
  }));
  dispatcher.dispatch(new sharedActions.SendTextChatMessage({
    contentType: loop.shared.utils.CHAT_CONTENT_TYPES.CONTEXT_TILE,
    message: "A marvelous page!",
    extraData: {
      roomToken: "fake",
      newRoomURL: "http://marvelous.invalid"
    },
    sentTimestamp: "2015-06-23T22:25:46.590Z"
  }));
  dispatcher.dispatch(new sharedActions.SendTextChatMessage({
    contentType: loop.shared.utils.CHAT_CONTENT_TYPES.TEXT,
    message: "What time should we meet?",
    sentTimestamp: "2015-06-23T22:27:45.590Z"
  }));
  dispatcher.dispatch(new sharedActions.ReceivedTextChatMessage({
    contentType: loop.shared.utils.CHAT_CONTENT_TYPES.TEXT,
    message: "8:00 PM",
    receivedTimestamp: "2015-06-23T22:27:45.590Z"
  }));
  dispatcher.dispatch(new sharedActions.ReceivedTextChatMessage({
    contentType: loop.shared.utils.CHAT_CONTENT_TYPES.NOTIFICATION,
    message: "peer_unexpected_quit",
    receivedTimestamp: "2015-06-23T22:28:45.590Z"
  }));

  loop.store.StoreMixin.register({
    activeRoomStore: activeRoomStore,
    textChatStore: textChatStore
  });

  // Local mocks
  var roomStoreOpenedRoom = new loop.store.RoomStore(dispatcher, {
    constants: {},
    activeRoomStore: makeActiveRoomStore({
      roomState: ROOM_STATES.HAS_PARTICIPANTS
    })
  });

  roomStoreOpenedRoom.setStoreState({
    openedRoom: "3jKS_Els9IU"
  });

  var roomStoreNoRooms = new loop.store.RoomStore(new loop.Dispatcher(), {
    constants: {},
    activeRoomStore: new loop.store.ActiveRoomStore(new loop.Dispatcher(), {
      sdkDriver: mockSDK
    })
  });

  roomStoreNoRooms.getAllRooms = function() {
    this.setStoreState({ pendingInitialRetrieval: false });

    this.dispatchAction(new sharedActions.UpdateRoomList({ roomList: [] }));

    // We can only start listening to room events after getAll() has been
    // called executed first.
    this.startListeningToRoomEvents();
  };

  /* xxx this is asynchronous - if start seeing things pending then this is the culprit */
  roomStoreNoRooms.setStoreState({ pendingInitialRetrieval: false });

  var roomStoreNoRoomsPending = new loop.store.RoomStore(new loop.Dispatcher(), {
    constants: {},
    activeRoomStore: new loop.store.ActiveRoomStore(new loop.Dispatcher(), {
      sdkDriver: mockSDK
    })
  });

  roomStoreNoRoomsPending.getAllRooms = function() {};

  var roomStoreCloseNewRoom = new loop.store.RoomStore(new loop.Dispatcher(), {
    constants: {},
    activeRoomStore: new loop.store.ActiveRoomStore(new loop.Dispatcher(), {
      sdkDriver: mockSDK
    })
  });
  roomStoreCloseNewRoom.setStoreState({
    renameRoom: "true"
  });

  var mockUserProfileLoggedIn = {
    email: "text@example.com",
    uid: "0354b278a381d3cb408bb46ffc01266"
  };

  var notifications = new loop.panel.models.NotificationCollection();
  var errNotifications = new loop.panel.models.NotificationCollection();
  errNotifications.add({
    level: "error",
    message: "Could Not Authenticate",
    details: "Did you change your password?",
    detailsButtonLabel: "Retry"
  });

  var SVGIcon = React.createClass({
    propTypes: {
      shapeId: React.PropTypes.string.isRequired,
      size: React.PropTypes.string.isRequired
    },

    render: function() {
      var sizeUnit = this.props.size.split("x");
      return (
        <img className="svg-icon"
             height={sizeUnit[1]}
             src={"shared/img/icons-" + this.props.size + ".svg#" + this.props.shapeId}
             width={sizeUnit[0]} />
      );
    }
  });

  var SVGIcons = React.createClass({
    propTypes: {
      size: React.PropTypes.string.isRequired
    },

    shapes: {
      "10x10": ["close", "close-active", "close-disabled", "close-darkergrey",
        "dropdown", "dropdown-white", "dropdown-active", "dropdown-disabled",
        "edit", "edit-active", "edit-disabled", "edit-white", "edit-darkgrey",
        "expand", "expand-active", "expand-disabled", "minimize",
        "minimize-active", "minimize-disabled", "settings-cog"
      ],
      "14x14": ["audio", "audio-active", "audio-disabled", "audio-still",
        "audio-white", "exit", "exit-active", "exit-white", "facemute",
        "facemute-active", "facemute-disabled", "facemute-still", "facemute-white",
        "hangup", "hangup-active", "hangup-disabled", "hangup-white", "hello",
        "hello-hover", "hello-active", "incoming", "incoming-active",
        "incoming-disabled", "link", "link-active", "link-disabled", "mute",
        "mute-active", "mute-disabled", "mute-still", "mute-white", "pause",
        "pause-active", "pause-disabled", "screen-white", "screen-hover",
        "screen-disabled", "screenmute-white", "video", "video-white",
        "video-active", "video-disabled", "video-still", "volume", "volume-active",
        "volume-disabled", "clear", "magnifier"
      ],
      "16x16": ["add", "add-hover", "add-active", "audio", "block", "block-red",
        "block-hover", "block-active", "copy", "checkmark", "delete", "globe",
        "google", "google-hover", "google-active", "history", "history-hover",
        "history-active", "leave", "loop-icon-still", "loop-icon-white",
        "settings", "settings-hover", "settings-active", "share-darkgrey",
        "tag", "tag-hover", "tag-active", "trash", "unblock", "unblock-hover",
        "unblock-active", "video"
      ]
    },

    render: function() {
      var icons = this.shapes[this.props.size].map(function(shapeId, i) {
        return (
          <div className="svg-icon-list-item" key={this.props.size + "-" + i}>
            <p className="svg-icon svg-icon-white-background">
              <SVGIcon shapeId={shapeId} size={this.props.size} />
            </p>
            <p className="svg-icon">
              <SVGIcon shapeId={shapeId} size={this.props.size} />
            </p>
            <p>{shapeId}</p>
          </div>
        );
      }, this);
      return (
        <div className="svg-icon-list">{icons}</div>
      );
    }
  });

  var FramedExample = React.createClass({
    propTypes: {
      children: React.PropTypes.element,
      cssClass: React.PropTypes.string,
      dashed: React.PropTypes.bool,
      height: React.PropTypes.number,
      onContentsRendered: React.PropTypes.func,
      summary: React.PropTypes.string.isRequired,
      width: React.PropTypes.number
    },

    makeId: function(prefix) {
      return (prefix || "") + this.props.summary.toLowerCase().replace(/\s/g, "-");
    },

    /* Need to wait until the content is loaded and rendered before we can get
      the Height of the content and set the iFrame to that height */
    componentDidMount: function() {
      this._checkFrameContentLoaded();
    },

    /* Check to see if content has been rendered, use timeout to run check again if
    rendering content not complete */
    _checkFrameContentLoaded: function() {
      if (this.props.height) {
        return;
      }

      var frameDOMNode = ReactDOM.findDOMNode(this.refs.frameNode);
      // For multi-browser compatibility allow for both contentDoc and contentWin
      var contentDoc = frameDOMNode.contentDocument || frameDOMNode.contentWindow.document;

      if (contentDoc.readyState && contentDoc.readyState === "complete") {
        this._resizeFrame();
      } else {
        setTimeout(function() {
          this._checkFrameContentLoaded();
        }.bind(this), 1000);
      }
    },

    _resizeFrame: function() {
      if (this.props.height) {
        return;
      }

      /* setTimeout added to allow for objects to adjust within the iframe,
      after being rendered, before grabbing height */
      setTimeout(function() {
        var frameDOMNode = ReactDOM.findDOMNode(this.refs.frameNode);
        // For multi-browser compatibility allow for both contentDoc and contentWin
        var contentDoc = frameDOMNode.contentDocument || frameDOMNode.contentWindow.document;
        // + 2 pixels for the 1 pixel border on top and bottom
        frameDOMNode.height = contentDoc.body.offsetHeight + 2;
      }.bind(this), 2000);
    },

    render: function() {
      var height = this.props.height;
      var width = this.props.width;

      // make room for a 1-pixel border on each edge
      if (this.props.dashed) {
        height += 2;
        width += 2;
      }

      var cx = classNames;
      return (
        <div className="example">
          <h3 id={this.makeId()}>
            {this.props.summary}
            <a href={this.makeId("#")}>&nbsp;¶</a>
          </h3>
          <div className="comp">
            <Frame className={cx({ dashed: this.props.dashed })}
                   cssClass={this.props.cssClass}
                   height={height}
                   onContentsRendered={this.props.onContentsRendered}
                   ref="frameNode"
                   width={width}>
              {this.props.children}
            </Frame>
          </div>
        </div>
      );
    }
  });

  var Section = React.createClass({
    propTypes: {
      children: React.PropTypes.oneOfType([
        React.PropTypes.arrayOf(React.PropTypes.element),
        React.PropTypes.element
      ]).isRequired,
      className: React.PropTypes.string,
      name: React.PropTypes.string.isRequired
    },

    render: function() {
      return (
        <section className={this.props.className} id={this.props.name}>
          <h1>{this.props.name}</h1>
          {this.props.children}
        </section>
      );
    }
  });

  var ShowCase = React.createClass({
    propTypes: {
      children: React.PropTypes.arrayOf(React.PropTypes.element).isRequired
    },

    getInitialState: function() {
      // We assume for now that rtl is the only query parameter.
      //
      // Note: this check is repeated in react-frame-component to save passing
      // rtlMode down the props tree.
      var rtlMode = document.location.search === "?rtl=1";

      return {
        rtlMode: rtlMode
      };
    },

    _handleCheckboxChange: function(newState) {
      var newLocation = "";
      if (newState.checked) {
        newLocation = document.location.href.split("#")[0];
        newLocation += "?rtl=1";
      } else {
        newLocation = document.location.href.split("?")[0];
      }
      newLocation += document.location.hash;
      document.location = newLocation;
    },

    render: function() {
      if (this.state.rtlMode) {
        document.documentElement.setAttribute("lang", "ar");
        document.documentElement.setAttribute("dir", "rtl");
      }

      return (
        <div className="showcase">
          <header>
            <h1>Loop UI Components Showcase</h1>
            <Checkbox checked={this.state.rtlMode} label="RTL mode?"
              onChange={this._handleCheckboxChange} />
            <nav className="showcase-menu">{
              React.Children.map(this.props.children, function(section) {
                return (
                  <a className="btn btn-info" href={"#" + section.props.name}>
                    {section.props.name}
                  </a>
                );
              })
            }</nav>
          </header>
          {this.props.children}
        </div>
      );
    }
  });

  var App = React.createClass({

    render: function() {
      return (
        <ShowCase>
          <Section name="PanelView">
            <p className="note">
              <strong>Note:</strong> 332px wide.
            </p>
            <FramedExample cssClass="fx-embedded-panel"
                           dashed={true}
                           summary="First time experience view"
                           width={330}>
              <div className="panel ftu-panel" height="553">
                <PanelView dispatcher={dispatcher}
                  gettingStartedSeen={false}
                  notifications={notifications}
                  roomStore={roomStore} />
              </div>
            </FramedExample>

            <FramedExample cssClass="fx-embedded-panel"
              dashed={true}
              summary="Re-sign-in view"
              width={332}>
              <div className="panel">
                <SignInRequestView />
              </div>
            </FramedExample>

            <FramedExample cssClass="fx-embedded-panel"
                           dashed={true}
                           summary="Room list"
                           width={330}>
              <div className="panel">
                <PanelView dispatcher={dispatcher}
                           notifications={notifications}
                           roomStore={roomStore}
                           userProfile={mockUserProfileLoggedIn} />
              </div>
            </FramedExample>

            <FramedExample cssClass="fx-embedded-panel"
                           dashed={true}
                           summary="Room list (active view)"
                           width={330}>
              <div className="panel">
                <PanelView dispatcher={dispatcher}
                           notifications={notifications}
                           roomStore={roomStoreOpenedRoom} />
              </div>
            </FramedExample>

            <FramedExample cssClass="fx-embedded-panel"
                           dashed={true}
                           summary="Room list (no rooms)"
                           width={330}>
              <div className="panel">
                <PanelView dispatcher={dispatcher}
                           notifications={notifications}
                           roomStore={roomStoreNoRooms} />
              </div>
            </FramedExample>

            <FramedExample cssClass="fx-embedded-panel"
                           dashed={true}
                           summary="Room list (loading view)"
                           width={330}>
              <div className="panel">
                <PanelView dispatcher={dispatcher}
                           notifications={notifications}
                           roomStore={roomStoreNoRoomsPending} />
              </div>
            </FramedExample>

            <FramedExample cssClass="fx-embedded-panel"
                           dashed={true}
                           height={250}
                           summary="Share panel"
                           width={330}>
              <div className="panel">
                <SharePanelView dispatcher={dispatcher}
                           forceRender={true}
                           from={"conversation"}
                           store={sharePanelActiveRoomStore} />
              </div>
            </FramedExample>

            <FramedExample cssClass="fx-embedded-panel"
                           dashed={true}
                           height={250}
                           summary="Rename closed room"
                           width={330}>
              <div className="panel">
                <RenameRoomView dispatcher={dispatcher}
                                roomName={"Fake name"}
                                roomToken={"fakeToken"} />
              </div>
            </FramedExample>

            <FramedExample cssClass="fx-embedded-panel"
                           dashed={true}
                           summary="Error Notification"
                           width={330}>
              <div className="panel">
                <PanelView dispatcher={dispatcher}
                           notifications={errNotifications}
                           roomStore={roomStore} />
              </div>
            </FramedExample>
            <FramedExample cssClass="fx-embedded-panel"
                           dashed={true}
                           summary="Error Notification - authenticated"
                           width={330}>
              <div className="panel">
                <PanelView dispatcher={dispatcher}
                           notifications={errNotifications}
                           roomStore={roomStore}
                           userProfile={mockUserProfileLoggedIn} />
              </div>
            </FramedExample>
          </Section>

          <Section name="CopyView">
            <FramedExample cssClass="fx-embedded-panel"
                           dashed={true}
                           summary="Copy panel"
                           width={330}>
              <div className="panel" height="100">
                <CopyView />
              </div>
            </FramedExample>
          </Section>

          <Section name="ConversationToolbar">
            <div>
              <FramedExample dashed={true}
                             height={56}
                             summary="Default"
                             width={300}>
                <div className="fx-embedded">
                  <ConversationToolbar audio={{ enabled: true, visible: true }}
                                       dispatcher={dispatcher}
                                       hangup={noop}
                                       publishStream={noop}
                                       settingsMenuItems={[{ id: "feedback" }]}
                                       show={true}
                                       video={{ enabled: true, visible: true }} />
                </div>
              </FramedExample>
              <FramedExample dashed={true}
                             height={56}
                             summary="Video muted"
                             width={300}>
                <div className="fx-embedded">
                  <ConversationToolbar audio={{ enabled: true, visible: true }}
                                       dispatcher={dispatcher}
                                       hangup={noop}
                                       publishStream={noop}
                                       settingsMenuItems={[{ id: "feedback" }]}
                                       show={true}
                                       video={{ enabled: false, visible: true }} />
                </div>
              </FramedExample>
              <FramedExample dashed={true}
                             height={56}
                             summary="Audio muted"
                             width={300}>
                <div className="fx-embedded">
                  <ConversationToolbar audio={{ enabled: false, visible: true }}
                                       dispatcher={dispatcher}
                                       hangup={noop}
                                       publishStream={noop}
                                       settingsMenuItems={[{ id: "feedback" }]}
                                       show={true}
                                       video={{ enabled: true, visible: true }} />
                </div>
              </FramedExample>
            </div>
          </Section>

          <Section name="FeedbackView">
            <p className="note">
            </p>
            <FramedExample dashed={true}
                           height={288}
                           summary="Default (useable demo)"
                           width={348}>
              <div className="fx-embedded">
                <FeedbackView onAfterFeedbackReceived={function() {}} />
              </div>
            </FramedExample>
          </Section>

          <Section name="AlertMessages">
            <FramedExample dashed={true}
                           height={288}
                           summary="Various alerts"
                           width={348}>
              <div>
                <div className="alert alert-warning">
                  <button className="close"></button>
                  <p className="message">
                    The person you were calling has ended the conversation.
                  </p>
                </div>
                <br />
                <div className="alert alert-error">
                  <button className="close"></button>
                  <p className="message">
                    The person you were calling has ended the conversation.
                  </p>
                </div>
              </div>
            </FramedExample>
          </Section>

          <Section name="UnsupportedBrowserView">
            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={430}
                           summary="Standalone Unsupported Browser"
                           width={768}>
              <div className="standalone">
                <UnsupportedBrowserView isFirefox={false} />
              </div>
            </FramedExample>
          </Section>

          <Section name="UnsupportedBrowserView">
            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={485}
                           summary="Standalone Unsupported Browser (Wide screen)"
                           width={1280}>
              <div className="standalone">
                <UnsupportedBrowserView isFirefox={false} />
              </div>
            </FramedExample>
          </Section>

          <Section name="UnsupportedDeviceView">
            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={430}
                           summary="Standalone Unsupported Device"
                           width={480}>
              <div className="standalone">
                <UnsupportedDeviceView platform="ios" />
              </div>
            </FramedExample>
          </Section>

          <Section name="RoomFailureView">
            <FramedExample
              dashed={true}
              height={288}
              summary="Desktop Room Failure View"
              width={348}>
              <div className="fx-embedded">
                <RoomFailureView
                  dispatcher={dispatcher}
                  failureReason={FAILURE_DETAILS.UNKNOWN} />
              </div>
            </FramedExample>
          </Section>

          <Section name="DesktopRoomConversationView">
            <FramedExample
              cssClass="desktop"
              height={448}
              onContentsRendered={invitationRoomStore.activeRoomStore.forcedUpdate}
              summary="Desktop room conversation (invitation, text-chat inclusion/scrollbars don't happen in real client)"
              width={348}>
              <div className="fx-embedded">
                <DesktopRoomConversationView
                  chatWindowDetached={false}
                  dispatcher={dispatcher}
                  facebookEnabled={true}
                  onCallTerminated={function() {}}
                  roomState={ROOM_STATES.INIT}
                  roomStore={invitationRoomStore} />
              </div>
            </FramedExample>

            <FramedExample dashed={true}
                           height={448}
                           onContentsRendered={desktopRoomStoreLoading.activeRoomStore.forcedUpdate}
                           summary="Desktop room conversation (loading)"
                           width={348}>
              {/* Hide scrollbars here. Rotating loading div overflows and causes
               scrollbars to appear */}
              <div className="fx-embedded overflow-hidden">
                <DesktopRoomConversationView
                  chatWindowDetached={false}
                  dispatcher={dispatcher}
                  facebookEnabled={true}
                  localPosterUrl="sample-img/video-screen-local.png"
                  onCallTerminated={function() {}}
                  remotePosterUrl="sample-img/video-screen-remote.png"
                  roomState={ROOM_STATES.HAS_PARTICIPANTS}
                  roomStore={desktopRoomStoreLoading} />
              </div>
            </FramedExample>

            <FramedExample dashed={true}
                           height={448}
                           onContentsRendered={roomStore.activeRoomStore.forcedUpdate}
                           summary="Desktop room conversation"
                           width={348}>
              <div className="fx-embedded">
                <DesktopRoomConversationView
                  chatWindowDetached={false}
                  dispatcher={dispatcher}
                  facebookEnabled={true}
                  localPosterUrl="sample-img/video-screen-local.png"
                  onCallTerminated={function() {}}
                  remotePosterUrl="sample-img/video-screen-remote.png"
                  roomState={ROOM_STATES.HAS_PARTICIPANTS}
                  roomStore={roomStore} />
              </div>
            </FramedExample>

            <FramedExample dashed={true}
                           height={482}
                           onContentsRendered={desktopRoomStoreMedium.activeRoomStore.forcedUpdate}
                           summary="Desktop room conversation (medium)"
                           width={602}>
              <div className="fx-embedded">
                <DesktopRoomConversationView
                  chatWindowDetached={false}
                  dispatcher={dispatcher}
                  facebookEnabled={true}
                  localPosterUrl="sample-img/video-screen-local.png"
                  onCallTerminated={function() {}}
                  remotePosterUrl="sample-img/video-screen-remote.png"
                  roomState={ROOM_STATES.HAS_PARTICIPANTS}
                  roomStore={desktopRoomStoreMedium} />
              </div>
            </FramedExample>

            <FramedExample dashed={true}
                           height={485}
                           onContentsRendered={desktopRoomStoreLarge.activeRoomStore.forcedUpdate}
                           summary="Desktop room conversation (large)"
                           width={646}>
              <div className="fx-embedded">
                <DesktopRoomConversationView
                  chatWindowDetached={false}
                  dispatcher={dispatcher}
                  facebookEnabled={true}
                  localPosterUrl="sample-img/video-screen-local.png"
                  onCallTerminated={function() {}}
                  remotePosterUrl="sample-img/video-screen-remote.png"
                  roomState={ROOM_STATES.HAS_PARTICIPANTS}
                  roomStore={desktopRoomStoreLarge} />
              </div>
            </FramedExample>

            <FramedExample dashed={true}
                           height={448}
                           onContentsRendered={desktopLocalFaceMuteRoomStore.activeRoomStore.forcedUpdate}
                           summary="Desktop room conversation local face-mute"
                           width={348}>
              <div className="fx-embedded">
                <DesktopRoomConversationView
                  chatWindowDetached={false}
                  dispatcher={dispatcher}
                  facebookEnabled={true}
                  onCallTerminated={function() {}}
                  remotePosterUrl="sample-img/video-screen-remote.png"
                  roomStore={desktopLocalFaceMuteRoomStore} />
              </div>
            </FramedExample>

            <FramedExample dashed={true}
                           height={448}
                           onContentsRendered={desktopRemoteFaceMuteRoomStore.activeRoomStore.forcedUpdate}
                           summary="Desktop room conversation remote face-mute"
                           width={348} >
              <div className="fx-embedded">
                <DesktopRoomConversationView
                  chatWindowDetached={false}
                  dispatcher={dispatcher}
                  facebookEnabled={true}
                  localPosterUrl="sample-img/video-screen-local.png"
                  onCallTerminated={function() {}}
                  remotePosterUrl="sample-img/video-screen-remote.png"
                  roomStore={desktopRemoteFaceMuteRoomStore} />
              </div>
            </FramedExample>
          </Section>

          <Section name="StandaloneHandleUserAgentView">
            <FramedExample
              cssClass="standalone"
              dashed={true}
              height={483}
              summary="Standalone Room Handle Join in Firefox"
              width={644} >
              <div className="standalone">
                <StandaloneHandleUserAgentView
                  activeRoomStore={readyRoomStore}
                  dispatcher={dispatcher} />
              </div>
            </FramedExample>
          </Section>

          <Section name="StandaloneRoomView">
            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={483}
                           summary="Standalone room introduction message"
                           width={644} >
              <div className="standalone">
                <StandaloneRoomView
                  activeRoomStore={readyRoomStore}
                  dispatcher={dispatcher}
                  introSeen={false}
                  isFirefox={true}
                  roomState={ROOM_STATES.READY} />
              </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={483}
                           summary="Standalone room conversation (ready)"
                           width={644} >
              <div className="standalone">
                <StandaloneRoomView
                  activeRoomStore={readyRoomStore}
                  dispatcher={dispatcher}
                  introSeen={true}
                  isFirefox={true}
                  roomState={ROOM_STATES.READY} />
              </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={483}
                           onContentsRendered={joinedRoomStore.forcedUpdate}
                           summary="Standalone room conversation (joined)"
                           width={644}>
              <div className="standalone">
                <StandaloneRoomView
                  activeRoomStore={joinedRoomStore}
                  dispatcher={dispatcher}
                  introSeen={true}
                  isFirefox={true}
                  localPosterUrl="sample-img/video-screen-local.png" />
              </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={483}
                           onContentsRendered={loadingRemoteVideoRoomStore.forcedUpdate}
                           summary="Standalone room conversation (loading remote)"
                           width={644}>
              <div className="standalone">
                <StandaloneRoomView
                  activeRoomStore={loadingRemoteVideoRoomStore}
                  dispatcher={dispatcher}
                  introSeen={true}
                  isFirefox={true}
                  localPosterUrl="sample-img/video-screen-local.png" />
              </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={483}
                           onContentsRendered={updatingActiveRoomStore.forcedUpdate}
                           summary="Standalone room conversation (has-participants, 644x483)"
                           width={644}>
                <div className="standalone">
                  <StandaloneRoomView
                    activeRoomStore={updatingActiveRoomStore}
                    dispatcher={dispatcher}
                    introSeen={true}
                    isFirefox={true}
                    localPosterUrl="sample-img/video-screen-local.png"
                    remotePosterUrl="sample-img/video-screen-remote.png"
                    roomState={ROOM_STATES.HAS_PARTICIPANTS} />
                </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={483}
                           onContentsRendered={localFaceMuteRoomStore.forcedUpdate}
                           summary="Standalone room conversation (local face mute, has-participants, 644x483)"
                           width={644}>
              <div className="standalone">
                <StandaloneRoomView
                  activeRoomStore={localFaceMuteRoomStore}
                  dispatcher={dispatcher}
                  introSeen={true}
                  isFirefox={true}
                  localPosterUrl="sample-img/video-screen-local.png"
                  remotePosterUrl="sample-img/video-screen-remote.png" />
              </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={483}
                           onContentsRendered={remoteFaceMuteRoomStore.forcedUpdate}
                           summary="Standalone room conversation (remote face mute, has-participants, 644x483)"
                           width={644}>
              <div className="standalone">
                <StandaloneRoomView
                  activeRoomStore={remoteFaceMuteRoomStore}
                  dispatcher={dispatcher}
                  introSeen={true}
                  isFirefox={true}
                  localPosterUrl="sample-img/video-screen-local.png"
                  remotePosterUrl="sample-img/video-screen-remote.png" />
              </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
              dashed={true}
              height={660}
              onContentsRendered={loadingRemoteLoadingScreenStore.forcedUpdate}
              summary="Standalone room convo (has-participants, loading screen share, loading remote video, 800x660)"
              width={800}>
              {/* Hide scrollbars here. Rotating loading div overflows and causes
               scrollbars to appear */}
               <div className="standalone overflow-hidden">
                  <StandaloneRoomView
                    activeRoomStore={loadingRemoteLoadingScreenStore}
                    dispatcher={dispatcher}
                    introSeen={true}
                    isFirefox={true}
                    localPosterUrl="sample-img/video-screen-local.png"
                    remotePosterUrl="sample-img/video-screen-remote.png"
                    roomState={ROOM_STATES.HAS_PARTICIPANTS} />
                </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={660}
                           onContentsRendered={loadingScreenSharingRoomStore.forcedUpdate}
                           summary="Standalone room convo (has-participants, loading screen share, 800x660)"
                           width={800}>
              {/* Hide scrollbars here. Rotating loading div overflows and causes
               scrollbars to appear */}
               <div className="standalone overflow-hidden">
                  <StandaloneRoomView
                    activeRoomStore={loadingScreenSharingRoomStore}
                    dispatcher={dispatcher}
                    introSeen={true}
                    isFirefox={true}
                    localPosterUrl="sample-img/video-screen-local.png"
                    remotePosterUrl="sample-img/video-screen-remote.png"
                    roomState={ROOM_STATES.HAS_PARTICIPANTS} />
                </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={660}
                           onContentsRendered={updatingSharingRoomStore.forcedUpdate}
                           summary="Standalone room convo (has-participants, receivingScreenShare, 800x660)"
                           width={800}>
                <div className="standalone">
                  <StandaloneRoomView
                    activeRoomStore={updatingSharingRoomStore}
                    dispatcher={dispatcher}
                    introSeen={true}
                    isFirefox={true}
                    localPosterUrl="sample-img/video-screen-local.png"
                    remotePosterUrl="sample-img/video-screen-remote.png"
                    roomState={ROOM_STATES.HAS_PARTICIPANTS}
                    screenSharePosterUrl="sample-img/video-screen-terminal.png" />
                </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={483}
                           summary="Standalone room conversation (full - FFx user)"
                           width={644}>
              <div className="standalone">
                <StandaloneRoomView
                  activeRoomStore={fullActiveRoomStore}
                  dispatcher={dispatcher}
                  introSeen={true}
                  isFirefox={true} />
              </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={483}
                           summary="Standalone room conversation (full - non FFx user)"
                           width={644}>
              <div className="standalone">
                <StandaloneRoomView
                  activeRoomStore={fullActiveRoomStore}
                  dispatcher={dispatcher}
                  introSeen={true}
                  isFirefox={false} />
              </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={483}
                           summary="Standalone room conversation (failed)"
                           width={644}>
              <div className="standalone">
                <StandaloneRoomView
                  activeRoomStore={failedRoomStore}
                  dispatcher={dispatcher}
                  introSeen={true}
                  isFirefox={false} />
              </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={483}
                           onContentsRendered={screenSharePausedActiveRoomStore.forcedUpdate}
                           summary="Standalone room sharing screan paused (has-participants)"
                           width={644}>
                <div className="standalone">
                  <StandaloneRoomView
                    activeRoomStore={screenSharePausedActiveRoomStore}
                    dispatcher={dispatcher}
                    isFirefox={true}
                    localPosterUrl="sample-img/video-screen-local.png"
                    roomState={ROOM_STATES.HAS_PARTICIPANTS} />
                </div>
            </FramedExample>
          </Section>

          <Section name="StandaloneRoomView (Mobile)">
            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={480}
                           onContentsRendered={updatingMobileActiveRoomStore.forcedUpdate}
                           summary="Standalone room conversation (has-participants, 600x480)"
                           width={600}>
                <div className="standalone">
                  <StandaloneRoomView
                    activeRoomStore={updatingMobileActiveRoomStore}
                    dispatcher={dispatcher}
                    introSeen={true}
                    isFirefox={true}
                    localPosterUrl="sample-img/video-screen-local.png"
                    remotePosterUrl="sample-img/video-screen-remote.png"
                    roomState={ROOM_STATES.HAS_PARTICIPANTS} />
                </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={480}
                           onContentsRendered={updatingSharingRoomMobileStore.forcedUpdate}
                           summary="Standalone room convo (has-participants, receivingScreenShare, 600x480)"
                           width={600} >
                <div className="standalone" cssClass="standalone">
                  <StandaloneRoomView
                    activeRoomStore={updatingSharingRoomMobileStore}
                    dispatcher={dispatcher}
                    introSeen={true}
                    isFirefox={true}
                    localPosterUrl="sample-img/video-screen-local.png"
                    remotePosterUrl="sample-img/video-screen-remote.png"
                    roomState={ROOM_STATES.HAS_PARTICIPANTS}
                    screenSharePosterUrl="sample-img/video-screen-terminal.png" />
                </div>
            </FramedExample>
          </Section>

          <Section name="TextChatView">
            <FramedExample dashed={true}
                           height={160}
                           summary="TextChatView: desktop embedded"
                           width={298}>
              <div className="fx-embedded">
                <TextChatView dispatcher={dispatcher}
                              showInitialContext={false} />
              </div>
            </FramedExample>

            <FramedExample cssClass="standalone"
                           dashed={true}
                           height={400}
                           summary="Standalone Text Chat conversation (200x400)"
                           width={200}>
              <div className="standalone text-chat-example">
                <div className="media-wrapper">
                  <TextChatView
                    dispatcher={dispatcher}
                    showInitialContext={true} />
                </div>
              </div>
            </FramedExample>
          </Section>

          <Section className="svg-icons" name="SVG icons preview">
            <FramedExample height={308}
                           summary="10x10"
                           width={730}>
              <SVGIcons size="10x10" />
            </FramedExample>
            <FramedExample height={768}
                           summary="14x14"
                            width={730}>
              <SVGIcons size="14x14" />
            </FramedExample>
            <FramedExample height={550}
                           summary="16x16"
                            width={730}>
              <SVGIcons size="16x16" />
            </FramedExample>
          </Section>

        </ShowCase>
      );
    }
  });

  var Failure = React.createClass({
    propTypes: {
      errorDetected: React.PropTypes.bool.isRequired,
      errorLine1: React.PropTypes.string,
      errorLine2: React.PropTypes.string,
      summary: React.PropTypes.string.isRequired
    },

    render: function() {
      // if no errors, return blank
      return !this.props.errorDetected ? null :
      (<li className="test fail">
          <h2>
            {this.props.summary}
          </h2>
          <pre className="error">
            {this.props.errorLine1 +
             this.props.errorLine2 ? "\n" + this.props.errorLine2 : ""}
          </pre>
        </li>
      );
    }
  });

  var Result = React.createClass({
    propTypes: {
      error: React.PropTypes.object,
      warnings: React.PropTypes.array
    },

    render: function() {
      var warningsDetected = this.props.warnings.length !== 0;
      var totalFailures = warningsDetected + !!this.props.error;

      return (
        <div className="error-summary">
          <div className="failures">
            <a>failures: </a>
            <em>{totalFailures}</em>
          </div>
          <ul>
            <Failure errorDetected={warningsDetected}
                     errorLine1={"Got: " + this.props.warnings.length}
                     summary="Unexpected warnings detected rendering UI-Showcase" />
            <Failure errorDetected={!!this.props.error}
                     errorLine1={this.props.error}
                     errorLine2={this.props.error ? this.props.error.stack : null}
                     summary="Errors rendering UI-Showcase" />
          </ul>
          <p id="complete">Completed</p>
        </div>
      );
    }
  });

  window.addEventListener("DOMContentLoaded", function() {
    var uncaughtError = null;
    var consoleWarn = console.warn;
    var caughtWarnings = [];
    console.warn = function() {
      var args = Array.prototype.slice.call(arguments);
      caughtWarnings.push(args);
      consoleWarn.apply(console, args);
    };

    try {
      ReactDOM.render(<App />, document.getElementById("main"));

      for (var listener of visibilityListeners) {
        listener({ target: { hidden: false } });
      }
    } catch (err) {
      console.error(err);
      uncaughtError = err;
    }

    // Wait until all the FramedExamples have been fully loaded.
    setTimeout(function waitForQueuedFrames() {
      if (window.queuedFrames.length !== 0) {
        setTimeout(waitForQueuedFrames, 500);
        return;
      }
      // Put the title back, in case views changed it.
      document.title = "Loop UI Components Showcase";

      ReactDOM.render(<Result error={uncaughtError}
                           warnings={caughtWarnings} />,
                   document.querySelector("#results"));
    }, 1000);

    // Page needs to scroll to hashtag again after iframe heights have been adjusted.
    setTimeout(function() {
      location.hash = location.hash;
    }, 5000);
  });

})();
