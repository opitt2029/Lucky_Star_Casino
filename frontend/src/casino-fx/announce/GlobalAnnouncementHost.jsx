import { useEffect } from 'react'
import AnnouncementTicker from './AnnouncementTicker'
import { startBotFeed, stopBotFeed } from './botFeed'
import { useSitePreferences } from '../../utils/sitePreferences'

export default function GlobalAnnouncementHost() {
  const [preferences] = useSitePreferences()

  useEffect(() => {
    if (preferences.announcementsEnabled) {
      startBotFeed()
    } else {
      stopBotFeed()
    }

    return () => stopBotFeed()
  }, [preferences.announcementsEnabled])

  return <AnnouncementTicker />
}
