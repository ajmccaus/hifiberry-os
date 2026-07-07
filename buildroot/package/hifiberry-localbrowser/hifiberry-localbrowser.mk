################################################################################
#
# hifiberry-localbrowser
#
################################################################################


define HIFIBERRY_LOCALBROWSER_BUILD_CMDS
endef

define HIFIBERRY_LOCALBROWSER_INSTALL_TARGET_CMDS
    # Local browser indication
    mkdir -p $(TARGET_DIR)/etc/hifiberry
    touch $(TARGET_DIR)/etc/hifiberry/localui.feature
    # libxkbcommon aborts compose-table setup (and WPE/cog crashes on the
    # NULL table) when /usr/share/X11/locale/<locale>/Compose is missing.
    # Empty tables are sufficient for the kiosk UI - no compose sequences.
    mkdir -p $(TARGET_DIR)/usr/share/X11/locale/C
    mkdir -p $(TARGET_DIR)/usr/share/X11/locale/C.UTF-8
    mkdir -p $(TARGET_DIR)/usr/share/X11/locale/en_US.UTF-8
    touch $(TARGET_DIR)/usr/share/X11/locale/C/Compose
    touch $(TARGET_DIR)/usr/share/X11/locale/C.UTF-8/Compose
    touch $(TARGET_DIR)/usr/share/X11/locale/en_US.UTF-8/Compose
endef

define HIFIBERRY_LOCALBROWSER_INSTALL_INIT_SYSTEMD
    $(INSTALL) -D -m 0644 $(BR2_EXTERNAL_HIFIBERRY_PATH)/package/hifiberry-localbrowser/cog.service \
           $(TARGET_DIR)/usr/lib/systemd/system/cog.service
    mkdir -p $(TARGET_DIR)/lib/systemd/system-preset
endef

$(eval $(generic-package))
